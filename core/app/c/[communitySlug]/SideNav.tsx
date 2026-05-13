import type { Communities, CommunitiesId, UsersId } from "db/public"
import type { User } from "lucia"
import type { MaybeHas } from "utils/types"
import type { CommunityData } from "~/lib/server/community"

import { cache, Suspense } from "react"
import { Bell } from "lucide-react"

import { Capabilities, MembershipType } from "db/public"
import {
	BookOpen,
	BookOpenText,
	Bot,
	ExternalLink,
	FlagTriangleRightIcon,
	Form,
	FormInput,
	Layers3,
	Mail,
	Settings2,
	ToyBrick,
	UsersRound,
} from "ui/icon"
import { InfoButton } from "ui/info-button"
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSkeleton,
	SidebarMenuSubItem,
	SidebarRail,
} from "ui/sidebar"

import { SidebarSearchDialogTrigger } from "~/app/components/Search/SearchDialogTrigger"
import { SidebarDarkmodeToggle } from "~/app/components/theme/DarkmodeToggle"
import { getLoginData } from "~/lib/authentication/loginData"
import { userCan, userCanViewStagePage } from "~/lib/authorization/capabilities"
import { env } from "~/lib/env/env"
import CommunitySwitcher from "./CommunitySwitcher"
import LoginSwitcher from "./LoginSwitcher"
import NavLink from "./NavLink"
import { NavLinkSubMenu } from "./NavLinkSubMenu"

type Props = {
	community: NonNullable<CommunityData>
	availableCommunities: NonNullable<CommunityData>[]
}

type BaseLinkDefinition = {
	href: string
	text: string
	authorization: null | ((userId: UsersId, communityId: CommunitiesId) => Promise<boolean>)
	pattern?: string
}

type SubMenuLinkDefinition = MaybeHas<BaseLinkDefinition, "href"> & {
	children: SubLevelLinkDefinition[] | SubMenuLinkDefinition[]
	icon: React.ReactNode
}

type TopLevelLinkDefinition = BaseLinkDefinition & {
	icon: React.ReactNode
}

type SubLevelLinkDefinition = BaseLinkDefinition & {
	icon?: React.ReactNode
}

export type LinkDefinition = TopLevelLinkDefinition | SubMenuLinkDefinition | SubLevelLinkDefinition

type LinkGroupDefinition = {
	name: string
	authorization: null | ((userId: UsersId, communityId: CommunitiesId) => Promise<boolean>)
	links: LinkDefinition[]
}

type EnvironmentToolLink = {
	href: string
	text: string
	icon: React.ReactNode
}

const userCanEditCommunityCached = cache(async (userId: UsersId, communityId: CommunitiesId) => {
	return await userCan(
		Capabilities.editCommunity,
		{
			type: MembershipType.community,
			communityId,
		},
		userId
	)
})

const viewLinks: LinkGroupDefinition = {
	name: "Views",
	authorization: null,
	links: [
		{
			href: "/pubs",
			text: "All Pubs",
			icon: <BookOpen size={16} />,
			authorization: null,
		},
		{
			href: "/stages",
			pattern: "/stages$",
			text: "All Workflows",
			icon: <FlagTriangleRightIcon size={16} />,
			authorization: userCanViewStagePage,
		},
		{
			href: "/activity/automations",
			text: "Automation Log",
			icon: <Bot size={16} />,
			authorization: userCanEditCommunityCached,
		},
	],
}

const manageLinks: LinkGroupDefinition = {
	name: "Manage",
	authorization: userCanEditCommunityCached,
	links: [
		{
			href: "/stages/manage",
			text: "Workflows",
			icon: <Layers3 size={16} />,
			pattern: "/stages/manage",
			authorization: userCanEditCommunityCached,
		},
		{
			href: "/forms",
			text: "Forms",
			icon: <Form size={16} />,
			authorization: userCanEditCommunityCached,
		},
		{
			href: "/types",
			text: "Types",
			icon: <ToyBrick size={16} />,
			authorization: userCanEditCommunityCached,
		},
		{
			href: "/fields",
			text: "Fields",
			icon: <FormInput size={16} />,
			authorization: userCanEditCommunityCached,
		},
		{
			href: "/members",
			text: "Members",
			icon: <UsersRound size={16} />,
			authorization: userCanEditCommunityCached,
		},
	],
}

const adminLinks: LinkGroupDefinition = {
	name: "Admin",
	authorization: userCanEditCommunityCached,
	links: [
		{
			text: "Settings",
			icon: <Settings2 size={16} />,
			authorization: userCanEditCommunityCached,
			children: [
				{
					href: "/settings/community",
					text: "Community",
					authorization: userCanEditCommunityCached,
				},
				{
					href: "/settings/tokens",
					text: "API Tokens",
					authorization: userCanEditCommunityCached,
				},
				{
					href: "/settings/actions",
					text: "Actions",
					authorization: userCanEditCommunityCached,
				},
				{
					href: "/settings/legacy-migration",
					text: "Imports",
					authorization: userCanEditCommunityCached,
				},
			],
		},
		{
			text: "Docs",
			icon: <BookOpenText size={16} />,
			authorization: userCanEditCommunityCached,
			children: [
				{
					href: "/developers/docs",
					text: "API",
					authorization: userCanEditCommunityCached,
				},
			],
		},
	],
}

const getEnvironmentToolLinks = (): EnvironmentToolLink[] => {
	const pubpubUrl = new URL(env.PUBSTAR_URL)

	const flags = env.FLAGS?.get("show-test-only-tools")
	if (!flags) {
		return []
	}

	const isLocalhost = pubpubUrl.hostname === "localhost" || pubpubUrl.hostname === "127.0.0.1"
	const inbucketUrl =
		env.INBUCKET_URL ?? (isLocalhost ? "http://localhost:54324" : `${pubpubUrl.origin}/emails`)
	const mockNotifyUrl = isLocalhost
		? "http://localhost:4001/mock-notify"
		: `${pubpubUrl.origin}/mock-notify`

	return [
		{
			href: inbucketUrl,
			text: "Email Inbox",
			icon: <Mail size={16} />,
		},
		{
			href: mockNotifyUrl,
			text: "COAR Server",
			icon: <Bell size={16} />,
		},
	]
}

export const COLLAPSIBLE_TYPE: Parameters<typeof Sidebar>[0]["collapsible"] = "icon"

const Links = ({
	user,
	community,
	links,
	groupName,
}: {
	user: User
	community: Communities
	links: LinkDefinition[]
	groupName?: string
}) => {
	return (
		<>
			{links.map((link) => {
				if (!("children" in link)) {
					return (
						<Suspense fallback={<SidebarMenuSkeleton />} key={link.href || link.text}>
							<Link
								key={link.href || link.text}
								user={user}
								community={community}
								link={link}
								groupName={groupName}
							/>
						</Suspense>
					)
				}

				return (
					<SubMenuLinks user={user} community={community} link={link} key={link.text} />
				)
			})}
		</>
	)
}

const Link = async ({
	user,
	community,
	link,
	groupName,
}: {
	user: User
	community: Communities
	link: TopLevelLinkDefinition | SubLevelLinkDefinition | SubMenuLinkDefinition
	groupName?: string
}) => {
	if (link.authorization) {
		const userCan = await link.authorization(user.id, community.id)

		if (!userCan) {
			return null
		}
	}

	return (
		<NavLink
			href={`/c/${community.slug}${link.href}`}
			text={link.text}
			icon={link.icon}
			pattern={link.pattern}
			groupName={groupName}
			hasChildren
			isChild={false}
		/>
	)
}

const SubMenuLinks = async ({
	user,
	community,
	link,
}: {
	user: User
	community: Communities
	link: SubMenuLinkDefinition
}) => {
	if (link.authorization) {
		const userCan = await link.authorization(user.id, community.id)

		if (!userCan) {
			return null
		}
	}

	return (
		<NavLinkSubMenu
			icon={link.icon}
			text={link.text}
			parentLink={
				link.href ? (
					<NavLink
						href={`/c/${community.slug}${link.href}`}
						text={link.text}
						icon={link.icon}
						pattern={link.pattern}
						hasChildren
						isChild={false}
					/>
				) : null
			}
		>
			{link.children.map((child) => (
				<SidebarMenuSubItem key={child.href}>
					<Link user={user} community={community} link={child} />
				</SidebarMenuSubItem>
			))}
		</NavLinkSubMenu>
	)
}

const LinkGroup = async ({
	user,
	community,
	group,
}: {
	user: User
	community: Communities
	group: LinkGroupDefinition
}) => {
	if (group.authorization) {
		const userCan = await group.authorization(user.id, community.id)

		if (!userCan) {
			return null
		}
	}

	return (
		<SidebarGroup className="group-data-[collapsible=icon]:py-0">
			<SidebarGroupLabel className="font-semibold text-muted-foreground uppercase group-data-[collapsible=icon]:hidden">
				{group.name}
			</SidebarGroupLabel>
			<SidebarGroupContent className="group-data-[state=expanded]:px-2">
				<Links
					user={user}
					community={community}
					links={group.links}
					groupName={group.name}
				/>
			</SidebarGroupContent>
		</SidebarGroup>
	)
}

const SideNav: React.FC<Props> = async ({ community, availableCommunities }) => {
	const { user } = await getLoginData()
	const environmentToolLinks = getEnvironmentToolLinks()

	if (!user) {
		return null
	}

	return (
		<Sidebar collapsible={COLLAPSIBLE_TYPE} className="fixed z-40 border-r-0!">
			<SidebarHeader className="py-4 group-data-[state=expanded]:p-4 group-data-[collapsible=icon]:pt-4 group-data-[state=expanded]:pb-2">
				<SidebarMenu>
					<SidebarMenuItem className={`h-full`}>
						<CommunitySwitcher
							community={community}
							availableCommunities={availableCommunities}
						/>
					</SidebarMenuItem>
				</SidebarMenu>
				{/* <SidebarSeparator className="group-data-[state=expanded]:mx-3 group-data-[collapsible=icon]:mt-3" /> */}
			</SidebarHeader>
			<SidebarContent className="group-data-[state=expanded]:px-1 group-data-[state=expanded]:py-3">
				<div className="flex h-full max-h-screen flex-col group-data-[state=expanded]:gap-2">
					<LinkGroup user={user} community={community} group={viewLinks} />
					<LinkGroup user={user} community={community} group={manageLinks} />
					<LinkGroup user={user} community={community} group={adminLinks} />
					{environmentToolLinks.length > 0 ? (
						<SidebarGroup className="group-data-[collapsible=icon]:py-0">
							<SidebarGroupLabel className="flex items-center gap-1 font-semibold text-muted-foreground uppercase group-data-[collapsible=icon]:hidden">
								<span>Dev tools</span>
								<InfoButton>
									These are only visible in development or preview environments.
								</InfoButton>
							</SidebarGroupLabel>
							<SidebarGroupContent className="group-data-[state=expanded]:px-2">
								<SidebarMenu>
									{environmentToolLinks.map((toolLink) => (
										<SidebarMenuItem key={toolLink.href}>
											<SidebarMenuButton asChild>
												<a
													href={toolLink.href}
													target="_blank"
													rel="noreferrer"
												>
													{toolLink.icon}
													<span className="text-sm">{toolLink.text}</span>
													<ExternalLink size={14} className="ml-auto" />
												</a>
											</SidebarMenuButton>
										</SidebarMenuItem>
									))}
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>
					) : null}
				</div>
			</SidebarContent>
			<SidebarFooter className="pb-4 group-data-[state=expanded]:px-2">
				<SidebarMenu>
					<SidebarGroup className="group-data-[collapsible=icon]:p-0">
						<SidebarGroupContent>
							<SidebarMenuItem>
								<SidebarSearchDialogTrigger />
							</SidebarMenuItem>
							<SidebarMenuItem className="relative flex items-center">
								<SidebarDarkmodeToggle />
							</SidebarMenuItem>
						</SidebarGroupContent>
					</SidebarGroup>
					<SidebarMenuItem>
						<LoginSwitcher />
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	)
}

export default SideNav
