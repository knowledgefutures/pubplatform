import type { Communities, Forms, Pubs, PubTypes, Stages } from "db/public"

import * as React from "react"
import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Img,
	Link,
	Preview,
	Section,
	Tailwind,
	Text,
} from "@react-email/components"

import { MemberRole } from "db/public"

type SignupInvitePropsBase = {
	inviteLink: string
	community: Pick<Communities, "name" | "avatar" | "slug">
	communityRole: MemberRole
	previewText?: string
	message?: string | React.ReactNode | null
}

type SignupInviteCommunity = SignupInvitePropsBase & {
	type: "community"
}

type SignupInviteForm = SignupInvitePropsBase & {
	type: "form"
	form: Pick<Forms, "name" | "slug">
}

type SignupInvitePub = SignupInvitePropsBase & {
	type: "pub"
	pub: Pick<Pubs, "title"> & {
		pubType: Pick<PubTypes, "name">
	}
	pubRole: MemberRole
}

type SignupInviteStage = SignupInvitePropsBase & {
	type: "stage"
	stage: Pick<Stages, "name">
	stageRole: MemberRole
}

export type SignupInviteProps =
	| SignupInviteCommunity
	| SignupInviteForm
	| SignupInvitePub
	| SignupInviteStage

const roleToVerb = {
	[MemberRole.admin]: "admin",
	[MemberRole.editor]: "edit",
	[MemberRole.contributor]: "contribute to",
} as const satisfies Record<MemberRole, string>

const communityRoleToVerb = {
	[MemberRole.admin]: "become an admin at",
	[MemberRole.editor]: "become an editor at",
	[MemberRole.contributor]: "join",
} as const satisfies Record<MemberRole, string>

const inviteMessage = (invite: SignupInviteProps) => {
	let extraText = ""
	if (invite.type === "stage") {
		extraText = ` and ${roleToVerb[invite.stageRole]} the stage ${invite.stage.name}`
	}

	if (invite.type === "pub") {
		extraText = ` and ${roleToVerb[invite.pubRole]} ${
			// todo: proper logic for articles
			invite.pub.title
				? `the Pub "${invite.pub.title}"`
				: `to a(n) ${invite.pub.pubType.name}`
		}`
	}

	return `You've been invited to ${communityRoleToVerb[invite.communityRole]} ${invite.community.name}${extraText}.`
}

const defaultPreviewText = (props: SignupInviteProps) => {
	return `Join ${props.community.name} on PubPub`
}

export const Invite = (props: SignupInviteProps) => {
	const baseUrl = process.env.PUBSTAR_URL ?? ""

	const community = props.community ?? {
		name: "CrocCroc",
		avatar: `${baseUrl}/demo/croc.png`,
		slug: "croccroc",
	}

	return (
		<Html>
			<Head />
			<Preview>{props.previewText ?? defaultPreviewText(props)}</Preview>
			<Tailwind>
				<Body className="mx-auto my-auto bg-white font-sans">
					<Container className="mx-auto my-[40px] w-[465px] rounded border border-[#eaeaea] border-solid p-[20px]">
						<Section className="mt-[32px]">
							<Img
								src={community.avatar ?? `${baseUrl}/apple-icon.png`}
								width="40"
								height="40"
								alt="PubPub"
								className="mx-auto my-0"
							/>
						</Section>
						<Heading className="mx-0 my-[30px] p-0 text-center font-normal text-[24px] text-black">
							Join {community.name} on PubPub
						</Heading>
						<Text className="text-[14px] text-black leading-[24px]">
							{props.message ?? inviteMessage(props)}
						</Text>
						<Section className="mt-[32px] mb-[32px] text-center">
							<Button
								className="rounded bg-[#000000] px-4 py-3 text-center font-semibold text-[12px] text-white no-underline"
								href={props.inviteLink}
							>
								View Invite
							</Button>
						</Section>
						<Text className="text-[14px] text-black leading-[24px]">
							or copy and paste this URL into your browser:{" "}
							<Link href={props.inviteLink} className="text-blue-600 no-underline">
								{props.inviteLink}
							</Link>
						</Text>
						<Hr className="mx-0 my-[26px] w-full border border-[#eaeaea] border-solid" />
						<Text className="text-[#666666] text-[12px] leading-[24px]">
							If you were not expecting this invitation, you can ignore this email. If
							you are concerned about your account's safety, please reply to this
							email to get in touch with us.
						</Text>
					</Container>
				</Body>
			</Tailwind>
		</Html>
	)
}
