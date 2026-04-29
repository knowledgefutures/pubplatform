"use server"

import { revalidatePath } from "next/cache"
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { sql } from "kysely"

import { db } from "~/kysely/database"
import { getLoginData } from "~/lib/authentication/loginData"
import { env } from "~/lib/env/env"
import { defineServerAction } from "~/lib/server/defineServerAction"
import { getJobsClient } from "~/lib/server/jobs"

const BACKUP_SCHEDULER_JOB_KEY = "database-backup-scheduler"

const getErrorMessage = (error: unknown, fallback: string) => {
	if (error instanceof Error) {
		return error.message
	}

	return fallback
}

const ensureSuperAdmin = async () => {
	const { user } = await getLoginData()
	if (!user?.isSuperAdmin) {
		return null
	}

	return user
}

const getBackupS3Client = () => {
	const bucket = env.S3_BACKUP_BUCKET
	const region = env.S3_BACKUP_REGION
	const accessKey = env.S3_BACKUP_ACCESS_KEY
	const secretKey = env.S3_BACKUP_SECRET_KEY
	const endpoint = env.S3_BACKUP_ENDPOINT

	const isMissingS3BackupConfig = !bucket || !region || !accessKey || !secretKey

	if (isMissingS3BackupConfig) {
		return null
	}

	return new S3Client({
		region,
		endpoint,
		credentials: {
			accessKeyId: accessKey,
			secretAccessKey: secretKey,
		},
		forcePathStyle: true,
	})
}

export const triggerBackup = defineServerAction(async function triggerBackup() {
	const user = await ensureSuperAdmin()
	if (!user) {
		return { title: "Unauthorized", error: "Must be a superadmin" }
	}

	const insertedBackup = await sql<{
		id: string
	}>`insert into backup_records (filename, "s3Key", status)
		values (${`queued-${Date.now()}.dump`}, ${"queued"}, 'pending'::"BackupStatus")
		returning id`
		.execute(db)
		.then((result) => result.rows[0])

	if (!insertedBackup) {
		return { title: "Backup failed", error: "Failed to create backup record" }
	}

	const jobsClient = await getJobsClient()
	const scheduleResult = await jobsClient.scheduleBackup({
		backupId: insertedBackup.id,
	})

	if ("error" in scheduleResult) {
		return {
			title: "Backup failed",
			error: getErrorMessage(scheduleResult.error, "Failed to queue backup"),
		}
	}

	revalidatePath("/superadmin")
})

export const deleteBackup = defineServerAction(async function deleteBackup({
	backupId,
}: {
	backupId: string
}) {
	const user = await ensureSuperAdmin()
	if (!user) {
		return { title: "Unauthorized", error: "Must be a superadmin" }
	}

	const backupRecord = await sql<{ id: string; s3Key: string }>`
		select id, "s3Key" from backup_records where id = ${backupId}::uuid
	`
		.execute(db)
		.then((result) => result.rows[0])

	if (!backupRecord) {
		return { title: "Not found", error: "Backup record not found" }
	}

	await sql`delete from backup_records where id = ${backupId}::uuid`.execute(db)

	const s3Client = getBackupS3Client()
	if (s3Client && env.S3_BACKUP_BUCKET && backupRecord.s3Key !== "queued") {
		await s3Client.send(
			new DeleteObjectCommand({
				Bucket: env.S3_BACKUP_BUCKET,
				Key: backupRecord.s3Key,
			})
		)
	}

	revalidatePath("/superadmin")
})

export const updateBackupConfig = defineServerAction(async function updateBackupConfig({
	enabled,
	intervalHours,
	retentionDays,
}: {
	enabled: boolean
	intervalHours: number
	retentionDays: number
}) {
	const user = await ensureSuperAdmin()
	if (!user) {
		return { title: "Unauthorized", error: "Must be a superadmin" }
	}

	await sql`
		with updated as (
			update backup_config
			set enabled = ${enabled},
				"intervalHours" = ${intervalHours},
				"retentionDays" = ${retentionDays}
			returning id
		)
		insert into backup_config (enabled, "intervalHours", "retentionDays")
		select ${enabled}, ${intervalHours}, ${retentionDays}
		where not exists (select 1 from updated)
	`.execute(db)

	const jobsClient = await getJobsClient()

	if (enabled) {
		const scheduleResult = await jobsClient.scheduleBackup({
			runAt: new Date(Date.now() + intervalHours * 60 * 60 * 1000),
			jobKey: BACKUP_SCHEDULER_JOB_KEY,
		})

		if ("error" in scheduleResult) {
			return {
				title: "Schedule failed",
				error: getErrorMessage(scheduleResult.error, "Failed to update backup schedule"),
			}
		}
	}

	if (!enabled) {
		await jobsClient.unscheduleJob(BACKUP_SCHEDULER_JOB_KEY)
	}

	revalidatePath("/superadmin")
})

export const getBackups = async () => {
	return db.selectFrom("backup_records").selectAll().orderBy("createdAt", "desc").execute()
}

export const getBackupConfig = async () => {
	const config = await db
		.selectFrom("backup_config")
		.selectAll()
		.orderBy("updatedAt", "desc")
		.limit(1)
		.executeTakeFirst()

	if (config) {
		return config
	}

	return {
		id: "00000000-0000-0000-0000-000000000000",
		enabled: false,
		intervalHours: 24,
		retentionDays: 14,
		createdAt: new Date(),
		updatedAt: new Date(),
	}
}
