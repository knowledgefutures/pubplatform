import type { TableCommunity } from "../communities/getCommunityTableColumns"

import { redirect } from "next/navigation"

import { db } from "~/kysely/database"
import { getPageLoginData } from "~/lib/authentication/loginData"
import { getMigrationStatus } from "~/lib/server/migrate"
import { SuperadminDashboard } from "./SuperadminDashboard"

export const metadata = {
	title: "Superadmin",
}

export const dynamic = "force-dynamic"

export default async function Page() {
	const { user } = await getPageLoginData()

	if (!user.isSuperAdmin) {
		redirect("/")
	}

	const [communities, migrationResult] = await Promise.all([
		db
			.selectFrom("communities")
			.select([
				"communities.id",
				"communities.name",
				"communities.slug",
				"communities.avatar",
				"createdAt",
			])
			.execute(),
		getMigrationStatus(),
	])

	const tableCommunities = communities.map((c) => ({
		id: c.id,
		name: c.name,
		slug: c.slug,
		avatar: c.avatar,
		created: new Date(c.createdAt),
	})) satisfies TableCommunity[]

	const migrations = "migrations" in migrationResult ? (migrationResult.migrations ?? []) : []
	const migrationError = "error" in migrationResult ? migrationResult.error : undefined

	return (
		<SuperadminDashboard
			communities={tableCommunities}
			migrations={migrations}
			migrationError={migrationError}
		/>
	)
}
