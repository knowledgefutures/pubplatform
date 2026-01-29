import type { TableCommunity } from "./getCommunityTableColumns"

import { Layers, Calendar } from "ui/icon"

import { db } from "~/kysely/database"
import { getPageLoginData } from "~/lib/authentication/loginData"
import { AddCommunity } from "./AddCommunityDialog"
import { CommunitiesClient } from "./CommunitiesClient"

export const metadata = {
	title: "Communities",
}

export default async function Page() {
	const { user } = await getPageLoginData()

	if (!user.isSuperAdmin) {
		return null
	}

	const communities = await db
		.selectFrom("communities")
		.select([
			"communities.id",
			"communities.name",
			"communities.slug",
			"communities.avatar",
			"createdAt",
		])
		.orderBy("createdAt", "desc")
		.execute()

	const tableCommunities = communities.map((community) => {
		const { id, name, slug, avatar, createdAt } = community
		return {
			id,
			name,
			slug,
			avatar,
			created: new Date(createdAt),
		} satisfies TableCommunity
	})

	return (
		<div className="mx-auto max-w-6xl px-4 py-8">
			<div className="mb-8">
				<div className="flex items-start justify-between">
					<div>
						<h1 className="flex items-center gap-2 font-semibold text-2xl tracking-tight">
							<Layers className="h-6 w-6" />
							Communities
						</h1>
						<p className="mt-1 text-muted-foreground">
							Manage all communities on this PubPub instance. Create new communities
							from scratch or use templates to duplicate existing configurations.
						</p>
					</div>
					<AddCommunity />
				</div>
			</div>

			<div className="mb-6 grid gap-4 md:grid-cols-3">
				<StatCard
					label="Total Communities"
					value={communities.length}
					icon={<Layers className="h-4 w-4" />}
				/>
				<StatCard
					label="Created This Month"
					value={countCreatedThisMonth(tableCommunities)}
					icon={<Calendar className="h-4 w-4" />}
				/>
				<StatCard
					label="Most Recent"
					value={tableCommunities[0]?.name ?? "None"}
					isText
					icon={<Layers className="h-4 w-4" />}
				/>
			</div>

			{tableCommunities.length === 0 ? (
				<EmptyState />
			) : (
				<div className="rounded-lg border bg-card">
					<CommunitiesClient communities={tableCommunities} />
				</div>
			)}
		</div>
	)
}

type StatCardProps = {
	label: string
	value: number | string
	icon: React.ReactNode
	isText?: boolean
}

const StatCard = ({ label, value, icon, isText }: StatCardProps) => (
	<div className="rounded-lg border bg-card p-4">
		<div className="flex items-center gap-2 text-muted-foreground text-sm">
			{icon}
			{label}
		</div>
		<div
			className={`mt-1 font-semibold ${isText ? "truncate text-base" : "text-2xl"}`}
			title={typeof value === "string" ? value : undefined}
		>
			{value}
		</div>
	</div>
)

const EmptyState = () => (
	<div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 py-16">
		<Layers className="mb-4 h-12 w-12 text-muted-foreground/50" />
		<h3 className="mb-1 font-medium text-lg">No communities yet</h3>
		<p className="mb-4 text-center text-muted-foreground text-sm">
			Create your first community to get started with PubPub.
		</p>
		<AddCommunity />
	</div>
)

const countCreatedThisMonth = (communities: TableCommunity[]) => {
	const now = new Date()
	const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
	return communities.filter((c) => c.created >= startOfMonth).length
}
