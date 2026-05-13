"use server"

import { revalidatePath } from "next/cache"
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3"

import { type BackupConfigId, type BackupRecordsId, BackupStatus } from "db/public"

import { db } from "~/kysely/database"
import { getLoginData } from "~/lib/authentication/loginData"
import { env } from "~/lib/env/env"
import { defineServerAction } from "~/lib/server/defineServerAction"
import { getJobsClient } from "~/lib/server/jobs"
import { maybeWithTrx } from "~/lib/server/maybeWithTrx"

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

	const insertedBackup = await db
		.insertInto("backup_records")
		.values({
			filename: `queued-${Date.now()}.dump`,
			s3Key: "queued",
			status: BackupStatus.pending,
		})
		.returning("id")
		.executeTakeFirst()

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

	await maybeWithTrx(db, async (trx) => {
		const backupRecord = await trx
			.selectFrom("backup_records")
			.selectAll()
			.where("id", "=", backupId as BackupRecordsId)
			.executeTakeFirst()

		if (!backupRecord) {
			return { title: "Not found", error: "Backup record not found" }
		}

		await trx
			.deleteFrom("backup_records")
			.where("id", "=", backupId as BackupRecordsId)
			.execute()

		const s3Client = getBackupS3Client()
		if (s3Client && env.S3_BACKUP_BUCKET && backupRecord.s3Key !== "queued") {
			await s3Client.send(
				new DeleteObjectCommand({
					Bucket: env.S3_BACKUP_BUCKET,
					Key: backupRecord.s3Key,
				})
			)
		}
	})

	revalidatePath("/superadmin")
})

export const updateBackupConfig = defineServerAction(async function updateBackupConfig({
	enabled,
	intervalHours,
	retentionDays,
	notificationEmail,
}: {
	enabled: boolean
	intervalHours: number
	retentionDays: number
	notificationEmail: string | null
}) {
	const user = await ensureSuperAdmin()
	if (!user) {
		return { title: "Unauthorized", error: "Must be a superadmin" }
	}

	const existingConfig = await db.selectFrom("backup_config").select("id").executeTakeFirst()

	if (existingConfig) {
		await db
			.updateTable("backup_config")
			.set({ enabled, intervalHours, retentionDays, notificationEmail })
			.where("id", "=", existingConfig.id)
			.execute()
	} else {
		await db
			.insertInto("backup_config")
			.values({ enabled, intervalHours, retentionDays, notificationEmail })
			.execute()
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
		id: "00000000-0000-0000-0000-000000000000" as BackupConfigId,
		enabled: false,
		intervalHours: 24,
		retentionDays: 14,
		notificationEmail: null as string | null,
		createdAt: new Date(),
		updatedAt: new Date(),
	}
}
