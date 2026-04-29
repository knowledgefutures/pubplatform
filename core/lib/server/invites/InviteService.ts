import type {
	CommunitiesId,
	FormsId,
	InvitesId,
	MemberRole,
	PubsId,
	StagesId,
	UsersId,
} from "db/public"
import type { Invite, LastModifiedBy, NewInvite } from "db/types"
import type { ExpressionBuilder } from "kysely"
import type { SafeUser } from "../user"
import type { InvitedByStep, NewUser } from "./InviteBuilder"

import crypto from "node:crypto"
import { jsonObjectFrom } from "kysely/helpers/postgres"

import { InviteStatus, MembershipType } from "db/public"
import { logger } from "logger"
import { expect } from "utils"

import { db } from "~/kysely/database"
import { compareMemberRoles } from "~/lib/authorization/rolesRanking"
import { env } from "~/lib/env/env"
import { createLastModifiedBy } from "~/lib/lastModifiedBy"
import { getLoginData } from "../../authentication/loginData"
import { autoRevalidate } from "../cache/autoRevalidate"
import { getCommunitySlug } from "../cache/getCommunitySlug"
import { maybeWithTrx } from "../maybeWithTrx"
import {
	coalesceMemberships,
	insertCommunityMembershipsOverrideRole,
	insertPubMembershipsOverrideRole,
	insertStageMembershipsOverrideRole,
	selectCommunityMemberships,
	selectPubMemberships,
	selectStageMemberships,
} from "../member"
import { addUser, generateUserSlug, getUser, SAFE_USER_SELECT } from "../user"
import { withInvitedFormIds } from "./helpers"
import { InviteBuilder } from "./InviteBuilder"

/**
 * Collection of methods for managing invites
 *
 * Maybe could also just be a module
 */
export namespace InviteService {
	//==============================================
	// Error classes
	//==============================================

	export const INVITE_ERRORS = {
		NOT_FOUND: "Invite not found",
		NOT_VALID: "Invite not actionable",
		NOT_FOR_USER: "Invite not for user",
		INVALID_TOKEN: "Invalid invite token",
		NOT_READY: "Invite not ready to be used",
		REJECTED: "Invite has been rejected",
		REVOKED: "Invite has been revoked",
		EXPIRED: "Invite has expired",
		USER_NOT_LOGGED_IN: "User not logged in",
		INVITE_USELESS: "Invite is useless, as it would not grant the user any new permissions",
		UNKNOWN: "Unknown invite error",
	} as const

	export const invalidInviteMap = {
		[InviteStatus.rejected]: "REJECTED",
		[InviteStatus.revoked]: "REVOKED",
		[InviteStatus.created]: "NOT_READY",
		[InviteStatus.accepted]: false,
		[InviteStatus.pending]: false,
		[InviteStatus.completed]: false,
	} satisfies Record<InviteStatus, false | InviteErrorType>

	export type InviteErrorType = keyof typeof INVITE_ERRORS

	export class InviteError extends Error {
		code: InviteErrorType
		status?: InviteStatus
		constructor(
			code: InviteErrorType,
			opts?: {
				status?: InviteStatus
				additionalMessage?: string
				logContext?: Record<string, unknown>
			}
		) {
			const msg = `${code}: ${INVITE_ERRORS[code]}.${opts?.additionalMessage ?? ""}`
			if (opts?.logContext) {
				// these are expected errors, so we don't want to log them as errors
				logger.debug({
					msg,
					...opts.logContext,
				})
			}
			super(msg)
			this.code = code
			this.status = opts?.status
		}
	}

	export const assertUserIsInvitee = (
		invite: Invite,
		user: { id: UsersId; email: string } | null
	) => {
		if (!user) {
			return
		}

		if (invite.userId && invite.userId !== user.id) {
			throw new InviteError("NOT_FOR_USER", {
				logContext: {
					inviteToken: invite.token,
					userId: user.id,
				},
				status: invite.status,
			})
		}
	}
	//==============================================

	/**
	 * Invite someone and create an account for them
	 */
	export function inviteUser(user: NewUser): InvitedByStep
	/**
	 * Invite a specific user
	 */
	export function inviteUser(user: UsersId): InvitedByStep
	export function inviteUser(user: UsersId | NewUser): InvitedByStep {
		// this looks silly, is just for typescript
		if (typeof user === "string") {
			return InviteBuilder.inviteUser(user)
		}
		return InviteBuilder.inviteUser(user)
	}

	/**
	 * @internal
	 */
	export async function _getInvite(token: string, id: InvitesId, trx = db) {
		return trx
			.selectFrom("invites")
			.where("token", "=", token)
			.where("id", "=", id)
			.selectAll()
			.select((eb) => withInvitedFormIds(eb, "invites.id"))
			.select((eb) => [
				jsonObjectFrom(
					eb
						.selectFrom("communities")
						.select(["id", "slug", "avatar", "name"])
						.whereRef("communities.id", "=", "invites.communityId")
				)
					.$notNull()
					.as("community"),
				jsonObjectFrom(
					eb
						.selectFrom("pubs")
						.select((eb) => [
							"id",
							"title",
							jsonObjectFrom(
								eb
									.selectFrom("pub_types")
									.select(["id", "name"])
									.whereRef("pub_types.id", "=", "pubs.pubTypeId")
							)
								.$notNull()
								.as("pubType"),
						])
						.whereRef("pubs.id", "=", "invites.pubId")
				).as("pub"),
				jsonObjectFrom(
					eb
						.selectFrom("stages")
						.select(["id", "name"])
						.whereRef("stages.id", "=", "invites.stageId")
				).as("stage"),
				jsonObjectFrom(
					eb
						.selectFrom("users")
						.select(SAFE_USER_SELECT)
						.whereRef("users.id", "=", "invites.userId")
				)
					.$notNull()
					.as("user"),
			])
			.executeTakeFirst() as Promise<Invite | null>
	}

	/**
	 * @internal
	 * Do not use directly
	 */
	export async function _createInvite(data: NewInvite, trx = db) {
		const {
			communityFormIds,
			pubFormIds,
			stageFormIds,
			communityFormSlugs,
			pubFormSlugs,
			stageFormSlugs,
			userId,
			provisionalUser,
			...restData
		} = data
		const communityFormSlugsOrIds = [...(communityFormSlugs ?? []), ...(communityFormIds ?? [])]
		const pubFormSlugsOrIds = [...(pubFormSlugs ?? []), ...(pubFormIds ?? [])]
		const stageFormSlugsOrIds = [...(stageFormSlugs ?? []), ...(stageFormIds ?? [])]

		const type =
			pubFormSlugsOrIds.length > 0
				? MembershipType.pub
				: stageFormSlugsOrIds.length > 0
					? MembershipType.stage
					: communityFormSlugsOrIds.length > 0
						? MembershipType.community
						: null

		const pubFormIdentifiersAreSlugs = Boolean(pubFormSlugs?.length)
		const stageFormIdentifiersAreSlugs = Boolean(stageFormSlugs?.length)
		const communityFormIdentifiersAreSlugs = Boolean(communityFormSlugs?.length)

		const toBeInvitedUser = await getUser(
			userId ? { id: userId } : { email: expect(provisionalUser).email },
			trx
		).executeTakeFirst()
		let toBeInvitedUserId = toBeInvitedUser?.id

		if (!toBeInvitedUserId) {
			if (userId) {
				throw new Error(`User not found. No user found with id: ${userId}`)
			}

			const provUser = expect(data.provisionalUser)
			expect(provUser)

			const newUser = await addUser(
				{
					firstName: provUser.firstName,
					lastName: provUser.lastName,
					email: provUser.email,
					slug: generateUserSlug({
						firstName: provUser.firstName,
						lastName: provUser.lastName,
					}),
					isProvisional: true,
				},
				trx
			).executeTakeFirstOrThrow()

			toBeInvitedUserId = newUser.id
		}

		const inviteBase = trx.with("invite", (db) =>
			db
				.insertInto("invites")
				.values({ ...restData, userId: toBeInvitedUserId })
				.returningAll()
		)

		const withFormSlugOrId = <EB extends ExpressionBuilder<any, any>>(
			eb: EB,
			identifier: string,
			isSlug: boolean
		) => {
			if (!isSlug) {
				return identifier as FormsId
			}

			return eb
				.selectFrom("forms")
				.select("id")
				.where("slug", "=", identifier)
				.where("communityId", "=", data.communityId)
				.limit(1)
		}

		const inviteWithForms = type
			? inviteBase.with("invite_forms", (db) =>
					db
						.insertInto("invite_forms")
						.values((eb) => [
							...(pubFormSlugsOrIds?.map((form) => ({
								inviteId: eb
									.selectFrom("invite")
									.select("id")
									.where("token", "=", data.token)
									.limit(1),
								formId: withFormSlugOrId(eb, form, pubFormIdentifiersAreSlugs),
								type: type,
							})) ?? []),
							...(stageFormSlugsOrIds?.map((form) => ({
								inviteId: eb
									.selectFrom("invite")
									.select("id")
									.where("token", "=", data.token)
									.limit(1),
								formId: withFormSlugOrId(eb, form, stageFormIdentifiersAreSlugs),
								type: MembershipType.stage,
							})) ?? []),
							...(communityFormSlugsOrIds?.map((formId) => ({
								inviteId: eb
									.selectFrom("invite")
									.select("id")
									.where("token", "=", data.token)
									.limit(1),
								formId: withFormSlugOrId(
									eb,
									formId,
									communityFormIdentifiersAreSlugs
								),
								type: MembershipType.community,
							})) ?? []),
						])
						.returningAll()
				)
			: inviteBase

		// for type safety this cast is necessary
		const inviteFinal = (inviteWithForms as typeof inviteBase)
			.selectFrom("invite")
			.selectAll()
			.select((eb) => [
				jsonObjectFrom(
					eb
						.selectFrom("communities")
						.select([
							"communities.id",
							"communities.slug",
							"communities.avatar",
							"communities.name",
						])
						.whereRef("communities.id", "=", "invite.communityId")
				)
					.$notNull()
					.as("community"),
				jsonObjectFrom(
					eb
						.selectFrom("pubs")
						.select((eb) => [
							"pubs.id",
							"pubs.title",
							jsonObjectFrom(
								eb
									.selectFrom("pub_types")
									.select(["pub_types.id", "pub_types.name"])
									.whereRef("pub_types.id", "=", "pubs.pubTypeId")
							)
								.$notNull()
								.as("pubType"),
						])
						.whereRef("pubs.id", "=", "invite.pubId")
				).as("pub"),
				jsonObjectFrom(
					eb
						.selectFrom("stages")
						.select(["stages.id", "stages.name"])
						.whereRef("stages.id", "=", "invite.stageId")
				).as("stage"),
			])
			.select((eb) => withInvitedFormIds(eb, "invite.id"))
			.select((eb) => [
				jsonObjectFrom(
					eb
						.selectFrom("users")
						.select(SAFE_USER_SELECT)
						.whereRef("users.id", "=", "invite.userId")
				)
					.$notNull()
					.as("user"),
			])

		const result = await autoRevalidate(inviteFinal).executeTakeFirstOrThrow()

		return result as Invite & { user: SafeUser }
	}

	/**
	 * Sets the status of an invite
	 * If the status is set to `pending`, it will also set the `lastSentAt` date
	 */
	export async function setInviteStatus(
		invite: Invite,
		status: InviteStatus,
		lastModifiedBy: LastModifiedBy,
		trx = db
	) {
		await autoRevalidate(
			trx
				.updateTable("invites")
				.set({
					status,
					lastModifiedBy,
					lastSentAt: status === InviteStatus.pending ? new Date() : undefined,
				})
				.where("id", "=", invite.id)
		).execute()
	}

	/**
	 * Sets the status of an invite to accepted
	 * Will check whether the user is allowed to accept the invite: will prevent accepting an invite for another user
	 *
	 * Therefore this should never be called as a consequence of a user other than the invitee invoking a server action
	 *
	 * @param _user {User?} Can technically also be used to accept an invite on behalf of a user who is just now created. This should be a rarer usecase, only really useful inside of a transaction, hence why it's the last option
	 *
	 * @throws {InviteError} If user is not logged in, or if user is not the invitee
	 */
	export async function completeInvite(
		invite: Invite,
		trx = db,
		_user?: { id: UsersId; email: string }
	) {
		const result = await maybeWithTrx(trx, async (trx) => {
			const { user } = _user ? { user: _user } : await getLoginData()

			if (!user) {
				throw new InviteError("USER_NOT_LOGGED_IN")
			}

			assertUserIsInvitee(invite, user)

			await setInviteStatus(
				invite,
				InviteStatus.completed,
				createLastModifiedBy({ userId: user.id }),
				trx
			)

			await grantInviteMemberships(invite, user, trx)
		})

		return result
	}

	/**
	 * Sets the status of an invite to reject
	 * Will check whether the user is allowed to reject the invite: will prevent rejecting an invite for another user
	 * Although technically anyone can reject an invite if they have it
	 *
	 * Therefore this should never be called as a consequence of a user other than the invitee invoking a server action
	 *
	 * @throws {InviteError}
	 */
	export async function rejectInvite(invite: Invite, trx = db) {
		const { user } = await getLoginData()

		if (user) {
			assertUserIsInvitee(invite, user)
		}

		await trx
			.updateTable("invites")
			.set({
				status: InviteStatus.rejected,
				// system here means that the user with the email rejected the invite
				// but they did not sign up yet (ofc)
				lastModifiedBy: createLastModifiedBy(user ? { userId: user.id } : "system"),
			})
			.where("id", "=", invite.id)
			.execute()
	}

	/**
	 * Revokes an invite for another user
	 *
	 * TODO: implement
	 */
	export async function revokeInvite(
		_token: string,
		_communityId: CommunitiesId,
		_reason?: string
	) {
		throw new Error("Not implemented")
	}

	/**
	 * @throws {InviteError}
	 */
	export async function getValidInviteForLoggedInUser(inviteToken: string, trx = db) {
		const [invite, { user }] = await Promise.all([
			getValidInvite(inviteToken, trx),
			getLoginData(),
		])

		assertUserIsInvitee(invite, user)

		return {
			invite,
			user: user!,
		}
	}

	/**
	 * User cannot be invited to a community if they are already a member of the community
	 */
	export async function canUserBeInvited(userId: UsersId, communityId: CommunitiesId, _trx = db) {
		const communityMember = await selectCommunityMemberships({
			userId,
			communityId,
		}).executeTakeFirst()

		return Boolean(communityMember)
	}

	/**
	 * Checks whether an invite is useless for a user
	 *
	 * This means that the invite would not grant any additional roles to the user
	 * This is only relevant when the user has already accepted another invite in the meantime.
	 * Currently there are no restrictions on number of open invites per user.
	 *
	 * @returns {Promise<{useless: false} | {useless: true, reason: string}>} true if the invite is useless, false otherwise
	 * @throws {InviteError} if the invite is not pending
	 */
	export async function isInviteUselessForUser(
		invite: Invite,
		user: { id: UsersId; email: string },
		trx = db
	): Promise<{ useless: false } | { useless: true; reason: string }> {
		assertUserIsInvitee(invite, user)

		if (invite.status !== InviteStatus.pending && invite.status !== InviteStatus.accepted) {
			return {
				useless: true,
				reason: "Invite is not pending or accepted",
			}
		}

		const communityMemberships = await selectCommunityMemberships(
			{
				userId: user.id,
				communityId: invite.communityId,
			},
			trx
		).execute()

		if (!communityMemberships?.length) {
			return {
				useless: false,
			}
		}

		const communityMembership = coalesceMemberships(communityMemberships)

		const isCommunityMemberUseless = isInviteUselessForMembership(
			{
				role: invite.communityRole,
				forms: invite.communityFormIds ?? [],
			},
			communityMembership
		)
		if (isCommunityOnlyInvite(invite)) {
			return isCommunityMemberUseless
		} else if (isPubInvite(invite)) {
			const pubMemberships = await selectPubMemberships(
				{
					userId: user.id,
					pubId: invite.pubId,
				},
				trx
			).execute()

			if (!pubMemberships?.length) {
				return {
					useless: false,
				}
			}
			const pubMember = coalesceMemberships(pubMemberships)

			const isPubMemberUseless = isInviteUselessForMembership(
				{
					role: invite.pubRole,
					forms: invite.pubFormIds ?? [],
				},
				pubMember
			)

			return isPubMemberUseless
		} else if (isStageInvite(invite)) {
			const stageMemberships = await selectStageMemberships(
				{
					userId: user.id,
					stageId: invite.stageId,
				},
				trx
			).execute()

			if (!stageMemberships?.length) {
				return {
					useless: false,
				}
			}
			const stageMember = coalesceMemberships(stageMemberships)

			const stageMemberUseless = isInviteUselessForMembership(
				{
					role: invite.stageRole,
					forms: invite.stageFormIds ?? [],
				},
				stageMember
			)

			return stageMemberUseless
		}

		throw new Error("Invalid invite")
	}

	/**
	 * Adds the user to the community, and possibly the pub or stage, based on the invite data.
	 * TODO: add form permissions once we have reworked them
	 */
	export async function grantInviteMemberships(
		invite: Invite,
		user: { id: UsersId; email: string },
		trx = db
	) {
		assertUserIsInvitee(invite, user)

		const _res = await maybeWithTrx(trx, async (trx) => {
			const isInviteUseless = await isInviteUselessForUser(invite, user, trx)
			if (isInviteUseless.useless) {
				logger.debug({
					msg: "For some reason, useless invite was accepted",
					invite,
					user,
					isInviteUseless,
				})
				return
			}

			// TODO: override lower level of permissions if the user has already accepted another invite
			if (isCommunityOnlyInvite(invite)) {
				await insertCommunityMembershipsOverrideRole(
					{
						communityId: invite.communityId,
						userId: user.id,
						role: invite.communityRole,
						forms: invite.communityFormIds ?? [],
					},
					trx
				).executeTakeFirstOrThrow()
			} else if (isPubInvite(invite)) {
				const _communityMember = await insertCommunityMembershipsOverrideRole(
					{
						communityId: invite.communityId,
						userId: user.id,
						role: invite.communityRole,
						forms: invite.communityFormIds ?? [],
					},
					trx
				).executeTakeFirstOrThrow()
				const _pubMember = await insertPubMembershipsOverrideRole(
					{
						pubId: invite.pubId,
						userId: user.id,
						role: invite.pubRole,
						forms: invite.pubFormIds ?? [],
					},
					trx
				).executeTakeFirstOrThrow()
			} else if (isStageInvite(invite)) {
				await insertCommunityMembershipsOverrideRole(
					{
						communityId: invite.communityId,
						userId: user.id,
						role: invite.communityRole,
						forms: invite.communityFormIds ?? [],
					},
					trx
				).executeTakeFirstOrThrow()
				await insertStageMembershipsOverrideRole(
					{
						stageId: invite.stageId,
						userId: user.id,
						role: invite.stageRole,
						forms: invite.stageFormIds ?? [],
					},
					trx
				).executeTakeFirstOrThrow()
			}

			// TODO: change this as soon as Kalil has implemented the form permissions
		})
	}

	/**
	 * Creates a link to an invite page with an invite token
	 */
	export async function createInviteLink(
		invite: Invite,
		options: {
			redirectTo: string
			/**
			 * If true, the url will be absolute
			 * @default true
			 */
			absolute?: boolean
		}
	) {
		const communitySlug = await getCommunitySlug()
		const inviteToken = createInviteToken(invite)

		const searchParams = new URLSearchParams()
		searchParams.set("invite", inviteToken)
		searchParams.set("redirectTo", options.redirectTo)

		return `${options?.absolute === false ? "" : env.PUBSTAR_URL}/c/${communitySlug}/public/invite?${searchParams.toString()}`
	}

	export function createInviteToken(invite: Invite) {
		return `${invite.id}.${invite.token}`
	}

	export function parseInviteToken(inviteToken: string) {
		const [id, token] = inviteToken.split(".")
		return { id: id as InvitesId, token }
	}

	/**
	 * Get an invite, and throw an error if it is not valid
	 * @throws {InviteError}
	 */
	export async function getValidInvite(inviteToken: string, trx = db) {
		const { id, token } = parseInviteToken(inviteToken)

		const dbInvite = await _getInvite(token, id, trx)

		if (!dbInvite) {
			throw new InviteError("NOT_FOUND", {
				logContext: {
					inviteToken,
				},
				status: InviteStatus.created,
			})
		}

		const isInvalidInvite = invalidInviteMap[dbInvite.status]
		if (isInvalidInvite) {
			throw new InviteError(isInvalidInvite, {
				logContext: {
					inviteToken,
					invite: dbInvite,
				},
				status: dbInvite.status,
			})
		}

		if (
			!crypto.timingSafeEqual(
				new Uint8Array(Buffer.from(dbInvite.token)),
				new Uint8Array(Buffer.from(token))
			)
		) {
			throw new InviteError("INVALID_TOKEN", {
				logContext: {
					inviteToken,
					invite: dbInvite,
				},
				status: dbInvite.status,
			})
		}

		if (dbInvite.expiresAt < new Date()) {
			throw new InviteError("EXPIRED", {
				logContext: {
					inviteToken,
					invite: dbInvite,
				},
				status: dbInvite.status,
			})
		}

		return dbInvite
	}
}

// helpers, don't need to be part of the service
function isCommunityOnlyInvite(invite: Invite): invite is Invite & { pubId: null; stageId: null } {
	return invite.pubId === null && invite.stageId === null
}

function isPubInvite(invite: Invite): invite is Invite & { pubId: PubsId } {
	return invite.pubId !== null
}

function isStageInvite(invite: Invite): invite is Invite & { stageId: StagesId } {
	return invite.stageId !== null
}

/**
 * does the invite grant any new roles or forms
 */
function isInviteUselessForMembership(
	invite: {
		role: MemberRole
		forms: FormsId[]
	},
	existingMembership: { role: MemberRole; forms: FormsId[] } | undefined
) {
	if (!existingMembership) {
		return {
			useless: false as const,
		}
	}

	const hasHigherOrSameRole = compareMemberRoles(existingMembership.role, ">=", invite.role)

	const inviteHasNoNewForms = invite.forms.some(
		(formId) => !existingMembership.forms.includes(formId)
	)

	if (hasHigherOrSameRole && inviteHasNoNewForms) {
		return {
			useless: true as const,
			reason: "Invite would not grant additional roles",
		}
	}

	return {
		useless: false as const,
	}
}
