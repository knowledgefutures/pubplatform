"use client"

import type { ColumnDef } from "@tanstack/react-table"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Badge } from "ui/badge"
import { Button } from "ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "ui/card"
import { CircleCheck, RefreshCw, XCircle } from "ui/icon"
import { cn } from "utils"

import { DataTable } from "~/app/components/DataTable/v2/DataTable"
import { resolveMigration, retryMigrations } from "./actions"

export type MigrationRow = {
	id: string
	checksum: string
	finished_at: Date | string | null
	migration_name: string
	logs: string | null
	rolled_back_at: Date | string | null
	started_at: Date | string
	applied_steps_count: number
}

type MigrationStatus = "applied" | "failed" | "rolled_back"

function getMigrationStatus(row: MigrationRow): MigrationStatus {
	if (row.rolled_back_at) {
		return "rolled_back"
	}

	if (row.finished_at) {
		return "applied"
	}

	return "failed"
}

function StatusBadge({ status }: { status: MigrationStatus }) {
	if (status === "applied") {
		return (
			<Badge variant="secondary" className="gap-1 bg-emerald-100 text-emerald-800">
				<CircleCheck className="h-3 w-3" />
				applied
			</Badge>
		)
	}

	if (status === "rolled_back") {
		return (
			<Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-800">
				<RefreshCw className="h-3 w-3" />
				rolled back
			</Badge>
		)
	}

	return (
		<Badge variant="destructive" className="gap-1">
			<XCircle className="h-3 w-3" />
			failed
		</Badge>
	)
}

function _formatDate(d: Date | string | null): string {
	if (!d) {
		return "-"
	}

	const date = typeof d === "string" ? new Date(d) : d
	return date.toLocaleString()
}

function _extractMigrationLabel(name: string): string {
	const parts = name.split("_")

	if (parts.length <= 1) {
		return name
	}

	return parts.slice(1).join("_")
}

export const MigrationsPanel = ({
	migrations,
	error,
}: {
	migrations: MigrationRow[]
	error?: string
}) => {
	const router = useRouter()
	const [isPending, startTransition] = useTransition()
	const [expandedRow, setExpandedRow] = useState<string | null>(null)

	const failedMigrations = migrations.filter((m) => getMigrationStatus(m) === "failed")
	const appliedCount = migrations.filter((m) => getMigrationStatus(m) === "applied").length
	const rolledBackCount = migrations.filter((m) => getMigrationStatus(m) === "rolled_back").length

	const handleResolve = (migrationName: string) => {
		startTransition(async () => {
			await resolveMigration({ migrationName })
			router.refresh()
		})
	}

	const handleRetry = () => {
		startTransition(async () => {
			await retryMigrations()
			router.refresh()
		})
	}

	const columns = useMemo(
		() =>
			[
				{
					id: "migration",
					header: "Migration",
					cell: ({ row }) => (
						<>
							<div className="truncate">
								<span className="font-mono text-sm">
									{_extractMigrationLabel(row.original.migration_name)}
								</span>

								<span className="ml-2 text-muted-foreground text-xs">
									{row.original.migration_name.split("_")[0]}
								</span>
							</div>

							{expandedRow === row.original.id && row.original.logs && (
								<pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
									{row.original.logs}
								</pre>
							)}
						</>
					),
				},
				{
					id: "status",
					header: "Status",
					size: 120,
					cell: ({ row }) => <StatusBadge status={getMigrationStatus(row.original)} />,
				},
				{
					id: "applied_at",
					header: "Applied at",
					size: 180,
					accessorFn: (row) => _formatDate(row.finished_at),
				},
			] as const satisfies ColumnDef<MigrationRow, unknown>[],
		[expandedRow]
	)

	if (error) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Migrations</CardTitle>
					<CardDescription>Could not load migration status</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-destructive text-sm">{error}</p>
				</CardContent>
			</Card>
		)
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h2 className="font-semibold text-lg">Migrations</h2>

				<Button
					variant="outline"
					size="sm"
					disabled={isPending}
					onClick={handleRetry}
					className="gap-2"
				>
					<RefreshCw className={cn("h-4 w-4", isPending && "animate-spin")} />
					Retry migrations
				</Button>
			</div>

			<div className="flex gap-4">
				<Card className="flex-1 py-4">
					<CardContent className="flex items-center gap-3">
						<div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100">
							<CircleCheck className="h-4 w-4 text-emerald-700" />
						</div>
						<div>
							<p className="font-semibold text-lg">{appliedCount}</p>
							<p className="text-muted-foreground text-xs">applied</p>
						</div>
					</CardContent>
				</Card>

				<Card className="flex-1 py-4">
					<CardContent className="flex items-center gap-3">
						<div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100">
							<RefreshCw className="h-4 w-4 text-amber-700" />
						</div>
						<div>
							<p className="font-semibold text-lg">{rolledBackCount}</p>
							<p className="text-muted-foreground text-xs">rolled back</p>
						</div>
					</CardContent>
				</Card>

				<Card className="flex-1 py-4">
					<CardContent className="flex items-center gap-3">
						<div
							className={cn(
								"flex h-8 w-8 items-center justify-center rounded-full",
								failedMigrations.length > 0 ? "bg-red-100" : "bg-muted"
							)}
						>
							<XCircle
								className={cn(
									"h-4 w-4",
									failedMigrations.length > 0
										? "text-red-700"
										: "text-muted-foreground"
								)}
							/>
						</div>
						<div>
							<p className="font-semibold text-lg">{failedMigrations.length}</p>
							<p className="text-muted-foreground text-xs">failed</p>
						</div>
					</CardContent>
				</Card>
			</div>

			{failedMigrations.length > 0 && (
				<Card className="max-w-full overflow-clip border-destructive/30 bg-destructive/5">
					<CardHeader>
						<CardTitle className="text-destructive">Failed migrations</CardTitle>
						<CardDescription>
							These migrations did not complete. Since migrations run inside a
							database transaction, the SQL changes were rolled back. You can mark
							them as resolved and retry.
						</CardDescription>
					</CardHeader>
					<CardContent className="w-full">
						<div className="space-y-3">
							{failedMigrations.map((m) => (
								<div
									key={m.id}
									className="flex items-center justify-between rounded-lg border bg-background p-3"
								>
									<div className="min-w-0 flex-0">
										<p className="truncate font-mono text-sm">
											{m.migration_name}
										</p>

										{m.logs && (
											<p className="mt-1 truncate text-muted-foreground text-xs">
												{m.logs.slice(0, 200)}
											</p>
										)}
									</div>

									<Button
										variant="outline"
										size="sm"
										disabled={isPending}
										onClick={() => handleResolve(m.migration_name)}
										className="ml-4 shrink-0"
									>
										Mark as resolved
									</Button>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}

			<div className="rounded-md border">
				<DataTable
					columns={columns}
					data={migrations}
					onRowClick={(row) => setExpandedRow(row.original.id)}
					pagination={{
						pageIndex: 0,
						pageSize: 200,
					}}
				/>

				{/* <Table className="w-92">
					<TableHeader>
						<TableRow>
							<TableHead className="w-[200px]">Migration</TableHead>
							<TableHead className="w-[100px]">Status</TableHead>
							<TableHead>Applied at</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{[...migrations].reverse().map((m) => {
							const status = getMigrationStatus(m)
							const isExpanded = expandedRow === m.id

							return (
								<TableRow
									key={m.id}
									className={cn(
										"cursor-pointer",
										status === "failed" && "bg-destructive/5"
									)}
									onClick={() => setExpandedRow(isExpanded ? null : m.id)}
								>
									<TableCell>
										<div className="truncate">
											<span className="font-mono text-sm">
												{extractMigrationLabel(m.migration_name)}
											</span>

											<span className="ml-2 text-muted-foreground text-xs">
												{m.migration_name.split("_")[0]}
											</span>
										</div>

										{isExpanded && m.logs && (
											<pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
												{m.logs}
											</pre>
										)}
									</TableCell>

									<TableCell>
										<StatusBadge status={status} />
									</TableCell>

									<TableCell className="text-muted-foreground text-sm">
										{formatDate(m.finished_at)}
									</TableCell>
								</TableRow>
							)
						})}

						{migrations.length === 0 && (
							<TableRow>
								<TableCell
									colSpan={4}
									className="h-24 text-center text-muted-foreground"
								>
									No migrations found
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table> */}
			</div>
		</div>
	)
}
