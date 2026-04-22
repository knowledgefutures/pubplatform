"use server"

import type {
	Communities,
	CommunitiesId,
	CommunityMemberships,
	FormsId,
	Users,
	UsersId,
} from "db/public"
import type { NoticeParams } from "~/app/components/Notice"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import * as Sentry from "@sentry/nextjs"
import { captureException } from "@sentry/nextjs"
import { z } from "zod"

import { AuthTokenType, MemberRole } from "db/public"
import { logger } from "logger"

import { compiledSignupFormSchema } from "~/app/components/Signup/schema"
import { db } from "~/kysely/database"
import { isUniqueConstraintError } from "~/kysely/errors"
import { lucia } from "~/lib/authentication/lucia"
import { createPasswordHash, validatePassword } from "~/lib/authentication/password"
import { defineServerAction } from "~/lib/server/defineServerAction"
import {
	addUser,
	generateUserSlug,
	getUser,
	hasUsers,
	publicSignupsAllowed,
	setUserPassword,
	updateUser,
} from "~/lib/server/user"
import { LAST_VISITED_COOKIE } from "../../app/components/LastVisitedCommunity/constants"
import { normalizeAssetUrl } from "../server/assets"
import { createSiteBuilderToken } from "../server/apiAccessTokens"
import { findCommunityBySlug } from "../server/community"
import * as Email from "../server/email"
import { insertCommunityMemberships, selectCommunityMemberships } from "../server/member"
import { redirectToBaseCommunityPage, redirectToLogin } from "../server/navigation/redirects"
import { invalidateTokensForUser } from "../server/token"
import { slugifyString } from "../string"
import { SignupErrors } from "./errors"
import { getLoginData } from "./loginData"
import { setupSchema } from "./schemas"

const schema = z.object({
	email: z.string().email(),
	password: z.string().min(1),
})

const getUserWithPasswordHash = async (props: Parameters<typeof getUser>[0]) =>
	getUser(props).select("users.passwordHash").executeTakeFirst()

async function redirectUser(
	memberships?: (Omit<CommunityMemberships, "memberGroupId"> & {
		community: Communities | null
	})[]
): Promise<never> {
	if (!memberships?.length) {
		redirect("/settings")
	}
	const cookieStore = await cookies()
	const lastVisited = cookieStore.get(LAST_VISITED_COOKIE)
	const communitySlug = lastVisited?.value ?? memberships[0].community?.slug

	return redirectToBaseCommunityPage({
		communitySlug,
	})
}

export const loginWithPassword = defineServerAction(async function loginWithPassword(props: {
	email: string
	password: string
	redirectTo: string | null
}) {
	const parsed = schema.safeParse({ email: props.email, password: props.password })

	if (parsed.error) {
		return {
			error: parsed.error.message,
		}
	}

	const { email, password } = parsed.data

	const user = await getUser({ email }).select("users.passwordHash").executeTakeFirst()

	if (!user) {
		return {
			error: "Incorrect email or password",
		}
	}

	if (!user.passwordHash) {
		return {
			// TODO: user has no password hash, either send them a password reset email or something
			error: "Incorrect email or password",
		}
	}
	const validPassword = await validatePassword(password, user.passwordHash)

	if (!validPassword) {
		return {
			error: "Incorrect email or password",
		}
	}
	// lucia authentication
	const tokenType = user.isVerified ? AuthTokenType.generic : AuthTokenType.verifyEmail
	const session = await lucia.createSession(user.id, { type: tokenType })
	const sessionCookie = lucia.createSessionCookie(session.id)
	;(await cookies()).set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)

	if (!user.isVerified) {
		const newUrl = props.redirectTo ? `/verify?redirectTo=${props.redirectTo}` : "/verify"
		redirect(newUrl)
	}

	if (props.redirectTo && /^\/\w+/.test(props.redirectTo)) {
		redirect(props.redirectTo)
	}
	await redirectUser(user.memberships)
})

export const logout = defineServerAction(async function logout(props: {
	redirectTo?: string
	destination?: string
	notice?: NoticeParams
}) {
	const { session } = await getLoginData()

	if (!session) {
		return {
			error: "Not logged in",
		}
	}

	await lucia.invalidateSession(session.id)

	const sessionCookie = lucia.createBlankSessionCookie()
	;(await cookies()).set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)

	const destinationPath = props.destination ?? "/login"
	const searchParams = new URLSearchParams()

	if (destinationPath) {
		if (props.notice) {
			searchParams.set("notice", JSON.stringify(props.notice))
		}

		if (props.redirectTo) {
			searchParams.set("redirectTo", props.redirectTo)
		}

		redirect(`${destinationPath}${searchParams.size ? `?${searchParams.toString()}` : ""}`)
	}

	redirectToLogin({
		loginNotice: {
			type: "notice",
			title: "You have successfully logged out.",
		},
	})
})

export const sendForgotPasswordMail = defineServerAction(
	async function sendForgotPasswordMail(props: { email: string }) {
		const user = await getUserWithPasswordHash({ email: props.email })

		if (!user) {
			return {
				success: true,
				report: "Password reset email sent!",
			}
		}

		const result = await Email.passwordReset({
			id: user.id,
			email: user.email,
			firstName: user.firstName,
			lastName: user.lastName,
		}).send()

		if ("error" in result) {
			return {
				error: result.error,
			}
		}

		return {
			success: true,
			report: result.report ?? "Password reset email sent!",
		}
	}
)

const _sendVerifyEmailMail = async (props: { email: string; redirectTo?: string }) => {
	const user = await getUserWithPasswordHash({ email: props.email })

	if (!user) {
		return {
			success: true,
			report: "Email verification email sent!",
		}
	}

	// Invalidate any previous tokens
	await invalidateTokensForUser(user.id, [AuthTokenType.generic])

	const result = await Email.verifyEmail(
		{
			id: user.id,
			email: user.email,
			firstName: user.firstName,
			lastName: user.lastName,
		},
		props.redirectTo
	).send()

	if ("error" in result) {
		return {
			error: result.error,
		}
	}

	return {
		success: true,
		report: result.report ?? "Email verification email sent!",
	}
}

export const sendVerifyEmailMail = defineServerAction(async function sendVerifyEmailMail(props: {
	email: string
	redirectTo?: string
}) {
	return _sendVerifyEmailMail(props)
})

const newPasswordSchema = z.object({
	password: z.string().min(8),
})

export const resetPassword = defineServerAction(async function resetPassword({
	password,
}: {
	password: string
}) {
	const parsed = newPasswordSchema.safeParse({ password })

	if (parsed.error) {
		return {
			error: "Invalid password",
		}
	}

	const { user } = await getLoginData({
		allowedSessions: [AuthTokenType.passwordReset],
	})

	if (!user) {
		return {
			error: "The password reset link is invalid or has expired. Please request a new one.",
		}
	}

	const fullUser = await getUserWithPasswordHash({ email: user.email })

	if (!fullUser) {
		return {
			error: "Something went wrong. Please request a new password reset link.",
		}
	}

	await setUserPassword({ userId: user.id, password })

	// clear all password reset tokens
	// TODO: maybe others as well?
	await invalidateTokensForUser(user.id, [AuthTokenType.passwordReset])

	// clear all sessions, including the current password reset session
	await lucia.invalidateUserSessions(user.id)

	return { success: true }
})

const _addUserToCommunity = defineServerAction(async function addUserToCommunity(props: {
	userId: UsersId
	communityId: CommunitiesId
	/**
	 * @default MemberRole.contributor
	 */
	role?: MemberRole
	forms: FormsId[]
}) {
	const existingMemberships = await selectCommunityMemberships({
		userId: props.userId,
		communityId: props.communityId,
	}).executeTakeFirst()

	if (existingMemberships) {
		return {
			error: "User already in community",
		}
	}

	const _newMembership = await insertCommunityMemberships({
		userId: props.userId,
		communityId: props.communityId,
		role: props.role ?? MemberRole.contributor,
		forms: props.forms,
	}).executeTakeFirstOrThrow()

	return {
		success: true,
		report: "User added to community",
	}
})

/**
 * When a user joins a community by signing up
 */
export const publicJoinCommunity = defineServerAction(async function joinCommunity() {
	const [{ user }, community] = await Promise.all([
		await getLoginData(),
		await findCommunityBySlug(),
	])

	// TODO: base this off the invite token
	const toBeGrantedRole = MemberRole.contributor

	if (!community) {
		return SignupErrors.COMMUNITY_NOT_FOUND({ communityName: "unknown" })
	}

	if (!user) {
		return SignupErrors.NOT_LOGGED_IN({ communityName: community.name })
	}

	if (user.memberships.some((m) => m.communityId === community.id)) {
		return SignupErrors.ALREADY_MEMBER({ communityName: community.name })
	}

	const isAllowedSignup = await publicSignupsAllowed(community.id)

	if (!isAllowedSignup) {
		return SignupErrors.NOT_ALLOWED({ communityName: community.name })
	}

	const _member = await insertCommunityMemberships({
		userId: user.id,
		communityId: community.id,
		role: toBeGrantedRole,
		forms: [], // TODO: fetch these from invite token as well maybe?
	}).executeTakeFirstOrThrow()

	// don't redirect, better to do it client side, better ux
	return {
		success: true,
		report: `You have joined ${community.name}`,
	}
})

export const publicSignup = defineServerAction(async function signup(props: {
	firstName: string
	lastName: string
	email: string
	password: string
	avatar?: string | null
	redirectTo?: string
	slug?: string
}) {
	const community = await findCommunityBySlug()
	if (!community) {
		return SignupErrors.COMMUNITY_NOT_FOUND({ communityName: "unknown" })
	}

	const [isAllowedSignup, { user }] = await Promise.all([
		publicSignupsAllowed(community.id),
		getLoginData(),
	])

	if (user) {
		redirect(`/c/${community.slug}/public/join?redirectTo=${props.redirectTo}`)
	}

	if (!isAllowedSignup) {
		return SignupErrors.NOT_ALLOWED({ communityName: community.name })
	}

	const input = {
		firstName: props.firstName,
		lastName: props.lastName,
		email: props.email,
		password: props.password,
		avatar: props.avatar,
	}

	const checked = compiledSignupFormSchema.Errors(input)
	const firstError = checked.First()

	if (firstError) {
		return {
			title: "Invalid signup",
			error: `${firstError.message} for ${firstError.path}`,
		}
	}

	const trx = db.transaction()
	const normalizedAvatar = props.avatar ? normalizeAssetUrl(props.avatar) : null

	const newUser = await trx.execute(async (trx) => {
		try {
			const newUser = await addUser(
				{
					firstName: props.firstName,
					lastName: props.lastName,
					email: props.email,
					slug:
						props.slug ??
						generateUserSlug({ firstName: props.firstName, lastName: props.lastName }),
					passwordHash: await createPasswordHash(props.password),
					isVerified: false,
					avatar: normalizedAvatar,
				},
				trx
			).executeTakeFirstOrThrow((err) => {
				Sentry.captureException(err)
				return new Error(
					`Unable to create user for public signup with email ${props.email}`
				)
			})

			// TODO: add to community
			const _newMember = await insertCommunityMemberships(
				{
					userId: newUser.id,
					communityId: community.id,
					role: MemberRole.contributor,
					forms: [], //TODO: make these customizable
				},
				trx
			).executeTakeFirstOrThrow()

			return { ...newUser, needsVerification: true }
		} catch (e) {
			if (isUniqueConstraintError(e) && e.table === "users") {
				return SignupErrors.EMAIL_ALREADY_EXISTS({ email: props.email })
			}
			logger.error({ msg: e })
			Sentry.captureException(e)
			throw e
		}
	})

	if ("error" in newUser) {
		return newUser
	}

	const verifyEmailResult = await _sendVerifyEmailMail({
		email: newUser.email,
		redirectTo: props.redirectTo,
	})

	if (verifyEmailResult.error) {
		return verifyEmailResult
	}

	// log them in with a session that requires email verification

	// lucia authentication
	const newSession = await lucia.createSession(newUser.id, { type: AuthTokenType.verifyEmail })
	const newSessionCookie = lucia.createSessionCookie(newSession.id)
	;(await cookies()).set(
		newSessionCookie.name,
		newSessionCookie.value,
		newSessionCookie.attributes
	)

	const newUrl = props.redirectTo ? `/verify?redirectTo=${props.redirectTo}` : "/verify"
	redirect(newUrl)
})

/**
 * flow for when a user has been invited to a community already
 */
export const legacySignup = defineServerAction(async function signup(
	userId: UsersId,
	props: {
		firstName: string
		lastName: string
		email: string
		password: string
		avatar?: string | null
		redirectTo?: string | null
	}
) {
	const { user, session } = await getLoginData({
		allowedSessions: [AuthTokenType.signup],
	})

	if (!user) {
		captureException(new Error("User tried to signup without existing"), {
			user: {
				id: userId,
				firstName: props.firstName,
				lastName: props.lastName,
				email: props.email,
			},
		})
		return {
			error: "Something went wrong. Please try again later.",
		}
	}

	if (user.id !== userId) {
		captureException(new Error("User tried to signup with a different id"), {
			user: {
				id: userId,
				firstName: props.firstName,
				lastName: props.lastName,
				email: props.email,
			},
		})
		return {
			error: "Something went wrong. Please try again later.",
		}
	}

	const trx = db.transaction()
	const normalizedAvatar = props.avatar ? normalizeAssetUrl(props.avatar) : null

	const updatedUser = await trx.execute(async (trx) => {
		const changedEmail = user.email !== props.email
		const updatedUser = await updateUser(
			{
				id: userId,
				firstName: props.firstName,
				lastName: props.lastName,
				email: props.email,
				avatar: normalizedAvatar,
				// If the user changed the email that they signed up with, make
				// sure they are not verified (magic-link login will mark them as verified)
				...(changedEmail ? { isVerified: false } : {}),
			},
			trx
		)

		await setUserPassword(
			{
				userId,
				password: props.password,
			},
			trx
		)

		if (changedEmail) {
			return { ...updatedUser, needsVerification: true }
		}

		return {
			...updatedUser,
			needsVerification: false,
		}
	})

	let sessionType = AuthTokenType.generic
	if ("needsVerification" in updatedUser && updatedUser.needsVerification) {
		const verifyEmailResult = await _sendVerifyEmailMail({
			email: updatedUser.email,
			redirectTo: props.redirectTo ?? undefined,
		})

		if (verifyEmailResult.error) {
			return verifyEmailResult
		}

		sessionType = AuthTokenType.verifyEmail
	}

	// invalidate sessions and tokens
	const [_invalidatedSessions, _invalidatedTokens] = await Promise.all([
		lucia.invalidateUserSessions(updatedUser.id),
		invalidateTokensForUser(updatedUser.id, [AuthTokenType.signup]),
	])

	// log them in
	const newSession = await lucia.createSession(updatedUser.id, { type: sessionType })
	const newSessionCookie = lucia.createSessionCookie(newSession.id)
	;(await cookies()).set(
		newSessionCookie.name,
		newSessionCookie.value,
		newSessionCookie.attributes
	)

	if (props.redirectTo) {
		redirect(props.redirectTo)
	}
	await redirectUser()

	// typescript cannot sense Promise<never> not returning
	return "" as never
})

// for invite signup, see the app/c/(public)/[communitySlug]/public/invite/actions.ts

export const initializeSetup = defineServerAction(async function initializeSetup(props: {
	email: string
	password: string
	firstName: string
	lastName?: string
	communityName: string
	communitySlug: string
	userAvatar?: string | null
	communityAvatar?: string | null
}) {
	const usersExist = await hasUsers()
	if (usersExist) {
		return {
			error: "Setup has already been completed",
		}
	}

	const parsed = setupSchema.safeParse(props)
	if (!parsed.success) {
		return {
			error: parsed.error.message,
		}
	}

	const {
		email,
		password,
		firstName,
		lastName,
		communityName,
		communitySlug,
		communityAvatar,
		userAvatar,
	} = parsed.data

	const normalizedUserAvatar = userAvatar ? normalizeAssetUrl(userAvatar) : null
	const normalizedCommunityAvatar = communityAvatar ? normalizeAssetUrl(communityAvatar) : null

	let result: { user: Users; community: Communities }
	try {
		result = await db.transaction().execute(async (trx) => {
			const passwordHash = await createPasswordHash(password)

			const newUser = await trx
				.insertInto("users")
				.values({
					email,
					firstName,
					lastName: lastName ?? null,
					slug: generateUserSlug({ firstName, lastName: lastName ?? null }),
					passwordHash,
					isSuperAdmin: true,
					isVerified: true,
					avatar: normalizedUserAvatar,
				})
				.returningAll()
				.executeTakeFirstOrThrow()

			const community = await trx
				.insertInto("communities")
				.values({
					name: communityName,
					slug: slugifyString(communitySlug),
					avatar: normalizedCommunityAvatar,
				})
				.returningAll()
				.executeTakeFirstOrThrow()

			await trx
				.insertInto("community_memberships")
				.values({
					userId: newUser.id as UsersId,
					communityId: community.id,
					role: MemberRole.admin,
				})
				.execute()

			await createSiteBuilderToken(community.id, trx)

			return { user: newUser, community }
		})

		const session = await lucia.createSession(result.user.id, { type: AuthTokenType.generic })
		const sessionCookie = lucia.createSessionCookie(session.id)

		;(await cookies()).set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)
	} catch (error) {
		if (isUniqueConstraintError(error)) {
			if (error.constraint === "users_email_key") {
				return {
					error: "A user with that email already exists",
				}
			}
			if (error.constraint === "communities_slug_key") {
				return {
					error: "A community with that slug already exists",
				}
			}
		}
		logger.error(error)
		return {
			error: "An unexpected error occurred",
		}
	}

	redirect(`/c/${result.community.slug}`)
})
