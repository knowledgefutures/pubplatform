import type { Communities, MembershipType, Users } from "db/public"
import type { SignupInviteProps } from "emails"
import type { SendMailOptions } from "nodemailer"
import type { XOR } from "utils/types"
import type { FormInviteLinkProps } from "./form"

import { render } from "@react-email/render"
import { FormLink, Invite, PasswordReset, VerifyEmail } from "emails"

import { AuthTokenType, MemberRole } from "db/public"
import { logger } from "logger"

import { db } from "~/kysely/database"
import { createMagicLink } from "~/lib/authentication/createMagicLink"
import { env } from "../env/env"
import { createFormInviteLink } from "./form"
import { getSmtpClient } from "./mailgun"

const FIFTEEN_MINUTES = 1000 * 60 * 15
const TWO_HOURS = 2 * 60 * 60 * 1000

type RequiredOptions = Required<Pick<SendMailOptions, "to" | "subject">> &
	XOR<{ html: string }, { text: string }>

export const DEFAULT_OPTIONS = {
	from: env.SMTP_FROM,
	name: env.SMTP_FROM_NAME 
} as const

function buildSend(emailPromise: () => Promise<RequiredOptions>) {
	const func = send.bind(null, emailPromise)

	return {
		send: func as (
			options?: Partial<Omit<SendMailOptions, "to" | "subject" | "html">> & {
				name?: string
			}
		) => Promise<
			{ success: true; report?: string; data: Record<string, unknown> } | { error: string }
		>,
	}
}

async function send(
	requiredPromise: () => Promise<RequiredOptions>,
	options?: Partial<Omit<SendMailOptions, "to" | "subject" | "html">> & {
		name?: string
	}
) {
	try {
		const required = await requiredPromise()

		logger.info({
			msg: `Sending email to ${required.to}`,
			options: {
				...required,
				...options,
			},
		})

		await getSmtpClient().sendMail({
			from: `${options?.name ?? DEFAULT_OPTIONS.name} <${options?.from ?? DEFAULT_OPTIONS.from}>`,
			to: required.to,
			subject: required.subject,
			html: required.html,
			text: required.text,
			...options,
		})

		return {
			success: true,
			report: "Email sent",
			data: {},
		}
	} catch (error) {
		logger.error({ msg: "Failed to send email", err: error })
		return {
			error: error.message,
		}
	}
}

export function passwordReset(
	user: Pick<Users, "id" | "email" | "firstName" | "lastName">,
	trx = db
) {
	return buildSend(async () => {
		const magicLink = await createMagicLink(
			{
				type: AuthTokenType.passwordReset,
				expiresAt: new Date(Date.now() + FIFTEEN_MINUTES),
				path: "/reset",
				userId: user.id,
			},
			trx
		)

		const email = await render(
			<PasswordReset
				firstName={user.firstName}
				lastName={user.lastName ?? undefined}
				resetPasswordLink={magicLink}
			/>
		)

		return {
			to: user.email,
			html: email,
			subject: "Reset your PubPub password",
		}
	})
}

export function verifyEmail(
	user: Pick<Users, "id" | "email" | "firstName" | "lastName">,
	redirectTo?: string,
	trx = db
) {
	return buildSend(async () => {
		const magicLink = await createMagicLink(
			{
				/**
				 * We use 'generic' here because they should be able to sign into their account
				 * once the link is clicked. Before this, they likely have the AuthTokenType.verifyEmail session
				 */
				type: AuthTokenType.generic,
				expiresAt: new Date(Date.now() + TWO_HOURS),
				path: redirectTo
					? `/verify?redirectTo=${encodeURIComponent(redirectTo)}`
					: "/verify",
				userId: user.id,
			},
			trx
		)

		const email = await render(
			<VerifyEmail firstName={user.firstName} verifyEmailLink={magicLink} />
		)

		return {
			to: user.email,
			html: email,
			subject: "Verify your email",
		}
	})
}

function _inviteToForm() {
	// TODO:
}

/**
 * @deprecated use SignupInvite instead
 */
export function _legacy_signupInvite(
	props: {
		user: Pick<Users, "id" | "email" | "firstName" | "lastName" | "slug">
		community: Pick<Communities, "name" | "avatar" | "slug">
		role: MemberRole
		membership: { type: MembershipType; name: string }
	},
	trx = db
) {
	const expiresAt = new Date()
	expiresAt.setDate(expiresAt.getDate() + 7)
	return buildSend(async () => {
		const magicLink = await createMagicLink(
			{
				type: AuthTokenType.signup,
				expiresAt,
				path: `/signup?redirectTo=${encodeURIComponent(`/c/${props.community.slug}/pubs`)}`,
				userId: props.user.id,
			},
			trx
		)

		const email = await render(
			<Invite
				community={props.community}
				inviteLink={magicLink}
				communityRole={props.role}
				type="community"
				message={
					<>
						You have been invited to become{" "}
						{props.role === MemberRole.contributor ? "a" : "an"}{" "}
						<strong>{props.role}</strong> of the {props.membership.type}{" "}
						<em>{props.membership.name}</em> on PubPub. Click the button below to finish
						your registration and join {props.community.name} on PubPub.
					</>
				}
			/>
		)

		return {
			to: props.user.email,
			html: email,
			subject: "Join PubPub",
		}
	})
}

export function signupInvite(
	props: SignupInviteProps & {
		to: string | string[]
		/**
		 * @default "Join {community.name} on PubPub"
		 */
		subject?: string
	},
	_trx = db
) {
	return buildSend(async () => {
		const email = await render(<Invite {...props} />)

		return {
			to: props.to,
			html: email,
			subject: props.subject ?? `Join ${props.community.name} on PubPub`,
		}
	})
}

export function formLink(
	props: {
		community: Pick<Communities, "name" | "avatar" | "slug">
		form: { name: string }
		subject: string
		to: string | string[]
	} & (FormInviteLinkProps | { formInviteLink: string })
) {
	return buildSend(async () => {
		const inviteLink =
			"formInviteLink" in props ? props.formInviteLink : await createFormInviteLink(props)

		const email = await render(
			<FormLink community={props.community} formInviteLink={inviteLink} form={props.form} />
		)

		return {
			to: props.to,
			subject: props.subject,
			html: email,
		}
	})
}

export function generic(opts: RequiredOptions) {
	return buildSend(async () => opts)
}
