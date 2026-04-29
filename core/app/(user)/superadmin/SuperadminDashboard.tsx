"use client"

import type { TableCommunity } from "../communities/getCommunityTableColumns"
import type { BackupRow } from "./BackupsPanel"
import type { MigrationRow } from "./MigrationsPanel"

import { parseAsString, useQueryState } from "nuqs"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/tabs"

import { AddCommunity } from "../communities/AddCommunityDialog"
import { CommunityTable } from "../communities/CommunityTable"
import { BackupsPanel } from "./BackupsPanel"
import { MigrationsPanel } from "./MigrationsPanel"

export const SuperadminDashboard = ({
	communities,
	migrations,
	migrationError,
	backups,
	backupConfig,
}: {
	communities: TableCommunity[]
	migrations: MigrationRow[]
	migrationError?: string
	backups: BackupRow[]
	backupConfig: {
		enabled: boolean
		intervalHours: number
		retentionDays: number
	}
}) => {
	const [activeTab, setActiveTab] = useQueryState("tab", parseAsString.withDefault("communities"))

	return (
		<div className="py-8">
			<h1 className="mb-8 font-bold text-2xl">Superadmin</h1>

			<Tabs defaultValue={activeTab} value={activeTab} onValueChange={setActiveTab}>
				<TabsList>
					<TabsTrigger value="communities">Communities</TabsTrigger>
					<TabsTrigger value="migrations">Migrations</TabsTrigger>
					<TabsTrigger value="backups">Backups</TabsTrigger>
				</TabsList>

				<TabsContent value="communities" className="pt-4">
					<div className="mb-6 flex items-center justify-between">
						<h2 className="font-semibold text-lg">Communities</h2>
						<AddCommunity />
					</div>

					<CommunityTable communities={communities} />
				</TabsContent>

				<TabsContent value="migrations" className="pt-4">
					<MigrationsPanel migrations={migrations} error={migrationError} />
				</TabsContent>

				<TabsContent value="backups" className="pt-4">
					<BackupsPanel backups={backups} config={backupConfig} />
				</TabsContent>
			</Tabs>
		</div>
	)
}
