"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { BackupRecordsId, BackupStatus } from "db/public"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Badge } from "ui/badge"
import { Button } from "ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "ui/card"
import { RefreshCw, XCircle } from "ui/icon"
import { Input } from "ui/input"
import { Switch } from "ui/switch"
import { cn } from "utils"

import { DataTable } from "~/app/components/DataTable/v2/DataTable"
import { deleteBackup, triggerBackup, updateBackupConfig } from "./backup-actions"

type BackupConfig = {
	enabled: boolean
	intervalHours: number
	retentionDays: number
}

export type BackupRow = {
	id: string
	filename: string
	s3Key: string
	sizeBytes: bigint | string | null
	status: BackupStatus
	error: string | null
	startedAt: Date | string | null
	completedAt: Date | string | null
	createdAt: Date | string
}

const formatDate = (value: Date | string | null) => {
	if (!value) {
		return "-"
	}

	const date = typeof value === "string" ? new Date(value) : value
	return date.toLocaleString()
}

const formatSize = (value: BackupRow["sizeBytes"]) => {
	if (!value) {
		return "-"
	}

	const bytes = typeof value === "bigint" ? Number(value) : Number(value)
	if (!Number.isFinite(bytes)) {
		return "-"
	}

	const mb = bytes / 1024 / 1024
	return `${mb.toFixed(1)} MB`
}

const StatusBadge = ({ status }: { status: BackupStatus }) => {
	if (status === "completed") {
		return <Badge className="bg-emerald-100 text-emerald-900">{status}</Badge>
	}

	if (status === "in_progress") {
		return <Badge className="bg-sky-100 text-sky-900">{status}</Badge>
	}

	if (status === "pending") {
		return <Badge variant="secondary">{status}</Badge>
	}

	return <Badge variant="destructive">{status}</Badge>
}

export const BackupsPanel = ({
	backups,
	config,
}: {
	backups: BackupRow[]
	config: BackupConfig
}) => {
	const router = useRouter()
	const [isPending, startTransition] = useTransition()
	const [enabled, setEnabled] = useState(config.enabled)
	const [intervalHours, setIntervalHours] = useState(String(config.intervalHours))
	const [retentionDays, setRetentionDays] = useState(String(config.retentionDays))

	const columns = useMemo(
		() =>
			[
				{
					id: "filename",
					header: "Filename",
					cell: ({ row }) => (
						<div className="max-w-[320px] truncate font-mono text-xs">
							{row.original.filename}
						</div>
					),
				},
				{
					id: "status",
					header: "Status",
					cell: ({ row }) => <StatusBadge status={row.original.status} />,
				},
				{
					id: "sizeBytes",
					header: "Size",
					accessorFn: (row) => formatSize(row.sizeBytes),
				},
				{
					id: "startedAt",
					header: "Started",
					accessorFn: (row) => formatDate(row.startedAt),
				},
				{
					id: "completedAt",
					header: "Completed",
					accessorFn: (row) => formatDate(row.completedAt),
				},
				{
					id: "actions",
					header: "",
					cell: ({ row }) => (
						<Button
							variant="ghost"
							size="sm"
							disabled={isPending}
							onClick={() =>
								startTransition(async () => {
									await deleteBackup({
										backupId: row.original.id as BackupRecordsId,
									})
									router.refresh()
								})
							}
						>
							Delete
						</Button>
					),
				},
			] as const satisfies ColumnDef<BackupRow, unknown>[],
		[isPending, router]
	)

	const handleSave = () => {
		startTransition(async () => {
			await updateBackupConfig({
				enabled,
				intervalHours: Number(intervalHours) || 24,
				retentionDays: Number(retentionDays) || 14,
			})

			router.refresh()
		})
	}

	const handleCreateNow = () => {
		startTransition(async () => {
			await triggerBackup()
			router.refresh()
		})
	}

	const hasFailedBackup = backups.some((backup) => backup.status === "failed")

	return (
		<div className="space-y-6 pt-4">
			<div className="flex items-center justify-between">
				<h2 className="font-semibold text-lg">Backups</h2>
				<Button disabled={isPending} onClick={handleCreateNow} className="gap-2">
					<RefreshCw className={cn("h-4 w-4", isPending && "animate-spin")} />
					Create backup now
				</Button>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Backup configuration</CardTitle>
					<CardDescription>
						Configure backup schedule and retention. Backup storage credentials are read
						from environment variables.
					</CardDescription>
				</CardHeader>

				<CardContent className="space-y-4">
					<div className="flex items-center gap-3">
						<Switch checked={enabled} onCheckedChange={setEnabled} />
						<span className="text-sm">Enable scheduled backups</span>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-1">
							<p className="text-sm">Interval (hours)</p>
							<Input
								value={intervalHours}
								onChange={(event) => setIntervalHours(event.target.value)}
							/>
						</div>

						<div className="space-y-1">
							<p className="text-sm">Retention (days)</p>
							<Input
								value={retentionDays}
								onChange={(event) => setRetentionDays(event.target.value)}
							/>
						</div>
					</div>

					<Button disabled={isPending} variant="outline" onClick={handleSave}>
						Save configuration
					</Button>
				</CardContent>
			</Card>

			{hasFailedBackup && (
				<Card className="border-destructive/30 bg-destructive/5">
					<CardHeader>
						<CardTitle className="text-destructive">Failed backups</CardTitle>
						<CardDescription>
							One or more backups failed. Check the error details below.
						</CardDescription>
					</CardHeader>
				</Card>
			)}

			<div className="rounded-md border">
				<DataTable
					columns={columns}
					data={backups}
					pagination={{
						pageIndex: 0,
						pageSize: 100,
					}}
				/>
			</div>

			{backups
				.filter((backup) => backup.error)
				.map((backup) => (
					<Card key={backup.id}>
						<CardHeader className="pb-2">
							<CardTitle className="flex items-center gap-2 font-mono text-sm">
								<XCircle className="h-4 w-4 text-destructive" />
								{backup.filename}
							</CardTitle>
						</CardHeader>
						<CardContent>
							<pre className="overflow-auto rounded bg-muted p-3 text-xs">
								{backup.error}
							</pre>
						</CardContent>
					</Card>
				))}
		</div>
	)
}
