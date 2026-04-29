import type { Database } from "db/Database"
import type {
	ActionRunsId,
	CommunitiesId,
	CommunityMembershipsId,
	PubsId,
	UsersId,
} from "db/public"
import type { Kysely } from "kysely"
import type { XOR } from "utils/types"

import { CoreSchemaType, InviteStatus, MemberRole } from "db/public"
import { assert, expect } from "utils"

import { db } from "~/kysely/database"
import { env } from "~/lib/env/env"
import { createLastModifiedBy } from "~/lib/lastModifiedBy"
import { autoCache } from "~/lib/server/cache/autoCache"
import { getCommunitySlug } from "../../cache/getCommunitySlug"
import { createFormInviteLink, grantFormAccess } from "../../form"
import { InviteService } from "../../invites/InviteService"

export type RenderWithPubRel = "self"

export type RenderWithPubPub = {
	id: string
	values: {
		fieldName: string
		fieldSlug: string
		value: unknown
		schemaName: CoreSchemaType
	}[]
	createdAt: Date
	title: string | null
	pubType: {
		name: string
	}
}

export type Recipient =
	| {
			id: CommunityMembershipsId
			user: {
				id: UsersId
				firstName: string
				lastName: string | null
				email: string
			}
			email?: never
	  }
	| { email: string; user?: never; id?: never }

export type RenderWithPubContext = {
	recipient?: Recipient
	communityId: CommunitiesId
	communitySlug: string
	pub: RenderWithPubPub
	inviter?: XOR<{ userId: UsersId }, { actionRunId: ActionRunsId }>
	trx: Kysely<Database>
}

export const ALLOWED_MEMBER_ATTRIBUTES = ["firstName", "lastName", "email"] as const

const getPub = (context: RenderWithPubContext, _rel?: string) => {
	return context.pub
}

const getPubValue = (context: RenderWithPubContext, fieldSlug: string, rel?: string) => {
	const pub = getPub(context, rel)
	const pubValue = pub.values.find((value) => value.fieldSlug === fieldSlug)
	return expect(pubValue, `Expected pub to have value for field "${fieldSlug}"`)
}

export const renderFormInviteLink = async (
	{
		formSlug,
		recipient,
		communityId,
		pubId,
		inviter,
	}: {
		formSlug: string
		recipient: Recipient
		communityId: CommunitiesId
		pubId: PubsId
		inviter: XOR<{ userId: UsersId }, { actionRunId: ActionRunsId }>
	},
	trx = db
) => {
	// a member is being invited
	if (recipient.id) {
		await grantFormAccess({ userId: recipient.user.id, communityId, pubId, slug: formSlug })
		return createFormInviteLink(
			{ userId: recipient.user.id, formSlug, communityId, pubId },
			trx
		)
	}

	const baseInvite = InviteService.inviteUser({
		email: recipient.email!,
		firstName: "",
		lastName: "",
	})
	const inviteWithInviter = baseInvite.invitedBy(
		inviter.userId ? { userId: inviter.userId } : { actionRunId: inviter.actionRunId! }
	)

	const communitySlug = await getCommunitySlug()

	const invite = await inviteWithInviter
		.forCommunity(communityId)
		.withRole(MemberRole.contributor)
		.withForms([formSlug])
		.forPub(pubId)
		.withRole(MemberRole.contributor)
		.withForms([formSlug])
		.expiresInDays(30)
		.create(trx)

	const inviteLink = await InviteService.createInviteLink(invite, {
		redirectTo: `/c/${communitySlug}/public/forms/${formSlug}/fill?pubId=${pubId}`,
	})

	await InviteService.setInviteStatus(
		invite,
		InviteStatus.pending,
		createLastModifiedBy({
			userId: inviter.userId,
			actionRunId: inviter.actionRunId,
		}),
		trx
	)

	return inviteLink
}

export const renderMemberFields = async ({
	fieldSlug,
	attributes,
	memberId,
	communitySlug,
}: {
	fieldSlug: string
	communitySlug: string
	attributes: string[]
	memberId: CommunityMembershipsId
}) => {
	// Make sure this field is a member type
	const fieldIsMemberTypeQuery = autoCache(
		db
			.selectFrom("pub_fields")
			.innerJoin("communities", "pub_fields.communityId", "communities.id")
			.where("pub_fields.slug", "=", fieldSlug)
			.where("communities.slug", "=", communitySlug)
			.where("pub_fields.schemaName", "=", CoreSchemaType.MemberId)
	)

	const userQuery = autoCache(
		db
			.selectFrom("community_memberships")
			.innerJoin("users", "users.id", "community_memberships.userId")
			.select(ALLOWED_MEMBER_ATTRIBUTES)
			.where("community_memberships.id", "=", memberId)
	)

	const [, user] = await Promise.all([
		fieldIsMemberTypeQuery.executeTakeFirstOrThrow(
			() => new Error(`Field ${fieldSlug} is not a member type`)
		),
		userQuery.executeTakeFirstOrThrow(
			() => new Error(`Did not find user with member ID "${memberId}"`)
		),
	])

	const relevantAttrs = attributes.filter(
		(attr): attr is (typeof ALLOWED_MEMBER_ATTRIBUTES)[number] =>
			(ALLOWED_MEMBER_ATTRIBUTES as ReadonlyArray<string>).includes(attr)
	)
	if (relevantAttrs.length) {
		return relevantAttrs.map((attr) => user[attr]).join(" ")
	}

	return memberId
}

type LinkEmailOptions = {
	email: string
	rel?: string
	text?: string
}

type LinkFormOptions = {
	form: string
	text?: string
}

type LinkUrlOptions = {
	to: string
	text?: string
}

type LinkFieldOptions = {
	field: string
	rel?: string
	text?: string
}

type LinkPageOptions = {
	page: string
	text?: string
}

export type LinkOptions =
	| LinkEmailOptions
	| LinkFormOptions
	| LinkUrlOptions
	| LinkFieldOptions
	| LinkPageOptions

const isLinkEmailOptions = (options: LinkOptions): options is LinkEmailOptions => {
	return "email" in options
}

const isLinkFormOptions = (options: LinkOptions): options is LinkFormOptions => {
	return "form" in options
}

const isLinkUrlOptions = (options: LinkOptions): options is LinkUrlOptions => {
	return "to" in options
}

const isLinkFieldOptions = (options: LinkOptions): options is LinkFieldOptions => {
	return "field" in options
}

const isLinkPageOptions = (options: LinkOptions): options is LinkPageOptions => {
	return "page" in options
}

const pageLinkHref = {
	pubs: () => `/pubs`,
	currentPub: (context) => `/pubs/${context.pub.id}`,
	stages: () => `/stages`,
} as const satisfies Record<string, (context: RenderWithPubContext) => string>

export const renderLink = (context: RenderWithPubContext, options: LinkOptions) => {
	let href: string
	if (isLinkEmailOptions(options)) {
		const to = options.email
		href = `mailto:${to}`
	} else if (isLinkFormOptions(options)) {
		// Form hrefs are handled by `renderFormInviteLink`
		href = ""
	} else if (isLinkUrlOptions(options)) {
		href = options.to
	} else if (isLinkFieldOptions(options)) {
		href = getPubValue(context, options.field, options.rel).value as string
	} else if (isLinkPageOptions(options)) {
		const baseUrl = `${env.PUBSTAR_URL}/c/${context.communitySlug}`

		let tempHref = baseUrl

		if (options.page in pageLinkHref) {
			tempHref = `${baseUrl}${pageLinkHref[options.page as keyof typeof pageLinkHref](context)}`
		} else {
			tempHref = `${baseUrl}/${options.page}`
		}

		href = tempHref
	} else {
		throw new Error("Unexpected link variant")
	}
	return href
}

export const contextWithUserRecipient = (context: RenderWithPubContext, token: string) => {
	assert(context.recipient, `Used a recipient token "${token}" without specifying a recipient`)

	assert(
		"user" in context.recipient,
		`Used a recipient token "${token}" without a user recipient`
	)

	return context as typeof context & {
		recipient: {
			id: CommunityMembershipsId
			user: NonNullable<typeof context.recipient>["user"]
		}
	}
}

export const renderRecipientFirstName = (context: RenderWithPubContext, token: string) => {
	return contextWithUserRecipient(context, token).recipient.user.firstName
}

export const renderRecipientLastName = (context: RenderWithPubContext, token: string) => {
	return contextWithUserRecipient(context, token).recipient.user.lastName ?? ""
}

export const renderRecipientFullName = (context: RenderWithPubContext, token: string) => {
	const lastName = renderRecipientLastName(context, token)
	return `${renderRecipientFirstName(context, token)}${lastName && ` ${lastName}`}`
}
