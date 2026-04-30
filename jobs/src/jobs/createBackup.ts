import type { JobHelpers } from "graphile-worker"
import type { BackupDatabase } from "../database"

import { execFile } from "node:child_process"
import { createReadStream } from "node:fs"
import { stat, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { DeleteObjectsCommand, type ObjectIdentifier, S3Client } from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import * as Sentry from "@sentry/node"
import nodemailer from "nodemailer"

import { type BackupRecordsId, BackupStatus } from "db/public"
import { logger } from "logger"

import { createBackupDatabase } from "../database"

const execFileAsync = promisify(execFile)

const DEFAULT_BACKUP_PREFIX = "pg-backups"
const DEFAULT_BACKUP_INTERVAL_HOURS = 24
const DEFAULT_BACKUP_RETENTION_DAYS = 14

type CreateBackupPayload = {
	backupId?: string
}

type BackupS3Config = {
	bucket: string
	region: string
	accessKey: string
	secretKey: string
	endpoint?: string
	keyPrefix: string
}

const ensureSentryInitialized = () => {
	const dsn = process.env.SENTRY_DSN
	if (!dsn) {
		return false
	}

	Sentry.init({ dsn })
	return true
}

const getBackupS3Config = (): BackupS3Config => {
	const bucket = process.env.S3_BACKUP_BUCKET
	const region = process.env.S3_BACKUP_REGION
	const accessKey = process.env.S3_BACKUP_ACCESS_KEY
	const secretKey = process.env.S3_BACKUP_SECRET_KEY
	const endpoint = process.env.S3_BACKUP_ENDPOINT
	const keyPrefix = process.env.S3_BACKUP_KEY_PREFIX ?? DEFAULT_BACKUP_PREFIX

	const isMissingRequiredBackupEnv = !bucket || !region || !accessKey || !secretKey
	if (isMissingRequiredBackupEnv) {
		throw new Error("Missing S3 backup configuration variables")
	}

	return {
		bucket,
		region,
		accessKey,
		secretKey,
		endpoint,
		keyPrefix,
	}
}

const getBackupConfig = async (db: import("kysely").Kysely<BackupDatabase>) => {
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
		enabled: false,
		intervalHours: DEFAULT_BACKUP_INTERVAL_HOURS,
		retentionDays: DEFAULT_BACKUP_RETENTION_DAYS,
		notificationEmail: null as string | null,
	}
}

const shouldRunScheduledBackup = async (db: import("kysely").Kysely<BackupDatabase>) => {
	const config = await getBackupConfig(db)

	if (!config.enabled) {
		return { shouldRun: false, reason: "backup is disabled", config } as const
	}

	const lastCompleted = await db
		.selectFrom("backup_records")
		.select("completedAt")
		.where("status", "=", BackupStatus.completed)
		.orderBy("completedAt", "desc")
		.limit(1)
		.executeTakeFirst()

	if (!lastCompleted?.completedAt) {
		return { shouldRun: true, config } as const
	}

	const intervalMs = config.intervalHours * 60 * 60 * 1000
	const elapsed = Date.now() - new Date(lastCompleted.completedAt).getTime()

	const shouldRun = elapsed >= intervalMs
	return { shouldRun, config, reason: shouldRun ? "backup is due" : "backup is not due" } as const
}

const upsertBackupRecordForRun = async (
	db: import("kysely").Kysely<BackupDatabase>,
	{
		backupId,
		filename,
		s3Key,
	}: {
		backupId?: string
		filename: string
		s3Key: string
	}
) => {
	if (!backupId) {
		const inserted = await db
			.insertInto("backup_records")
			.values({ filename, s3Key, status: BackupStatus.pending })
			.returning("id")
			.executeTakeFirstOrThrow()

		return inserted.id
	}

	await db
		.updateTable("backup_records")
		.set({ filename, s3Key })
		.where("id", "=", backupId as BackupRecordsId)
		.execute()

	return backupId
}

const updateBackupRecord = async (
	db: import("kysely").Kysely<BackupDatabase>,
	backupId: string,
	update: {
		status: BackupStatus
		error?: string | null
		sizeBytes?: string | null
		startedAt?: Date | null
		completedAt?: Date | null
	}
) => {
	await db
		.updateTable("backup_records")
		.set({
			status: update.status,
			...(update.error !== undefined ? { error: update.error } : {}),
			...(update.sizeBytes !== undefined ? { sizeBytes: update.sizeBytes } : {}),
			...(update.startedAt !== undefined ? { startedAt: update.startedAt } : {}),
			...(update.completedAt !== undefined ? { completedAt: update.completedAt } : {}),
		})
		.where("id", "=", backupId as BackupRecordsId)
		.execute()
}

const cleanupExpiredBackups = async (
	db: import("kysely").Kysely<BackupDatabase>,
	s3Client: S3Client,
	backupS3Config: BackupS3Config,
	retentionDays: number
) => {
	const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)

	const expiredBackups = await db
		.selectFrom("backup_records")
		.select(["id", "s3Key"])
		.where("status", "=", BackupStatus.completed)
		.where("completedAt", "is not", null)
		.where("completedAt", "<", cutoff)
		.execute()

	if (expiredBackups.length === 0) {
		return
	}

	const objects = expiredBackups.map((backup) => ({
		Key: backup.s3Key,
	})) satisfies ObjectIdentifier[]

	await s3Client.send(
		new DeleteObjectsCommand({
			Bucket: backupS3Config.bucket,
			Delete: { Objects: objects, Quiet: true },
		})
	)

	await db
		.deleteFrom("backup_records")
		.where(
			"id",
			"in",
			expiredBackups.map((b) => b.id)
		)
		.execute()
}

const getBackupFileData = (databaseUrl: string, keyPrefix: string) => {
	const timestamp = new Date().toISOString().replace(/[:-]/g, "").split(".")[0] + "Z"
	const dbName = new URL(databaseUrl).pathname.slice(1) || "appdb"
	const filename = `${dbName}-${timestamp}.dump`
	const localPath = path.join(tmpdir(), filename)
	const normalizedPrefix = keyPrefix.replace(/\/+$/, "")
	const s3Key = `${normalizedPrefix}/${filename}`

	return { filename, localPath, s3Key }
}

const sendFailureNotification = async (
	notificationEmail: string,
	errorMessage: string,
	filename: string
) => {
	const smtpHost = process.env.SMTP_HOST
	const smtpPort = process.env.SMTP_PORT
	const smtpUser = process.env.SMTP_USERNAME
	const smtpPass = process.env.SMTP_PASSWORD
	const smtpFrom = process.env.SMTP_FROM

	const isMissingSmtpConfig = !smtpHost || !smtpPort || !smtpUser || !smtpPass || !smtpFrom
	if (isMissingSmtpConfig) {
		logger.warn({
			msg: "cannot send backup failure notification, missing SMTP configuration",
		})
		return
	}

	try {
		const transporter = nodemailer.createTransport({
			host: smtpHost,
			port: parseInt(smtpPort, 10),
			auth: { user: smtpUser, pass: smtpPass },
		})

		await transporter.sendMail({
			from: smtpFrom,
			to: notificationEmail,
			subject: `Database backup failed: ${filename}`,
			text: [
				`A scheduled database backup has failed.`,
				``,
				`Filename: ${filename}`,
				`Error: ${errorMessage}`,
				`Time: ${new Date().toISOString()}`,
				``,
				`Check the superadmin dashboard for more details.`,
			].join("\n"),
		})

		logger.info({ msg: "sent backup failure notification email", to: notificationEmail })
	} catch (err) {
		logger.warn({
			msg: "error sending backup failure notification email",
			error: err instanceof Error ? err.message : String(err),
		})
	}
}

export const createBackup = async (payload: CreateBackupPayload, _helpers: JobHelpers) => {
	const databaseUrl = process.env.DATABASE_URL
	if (!databaseUrl) {
		throw new Error("Missing DATABASE_URL")
	}

	const { db, pool } = createBackupDatabase(databaseUrl)

	// for cron-triggered runs (no backupId), check whether we actually need to run
	const isScheduledRun = !payload.backupId
	if (isScheduledRun) {
		const { shouldRun, reason } = await shouldRunScheduledBackup(db)

		if (!shouldRun) {
			logger.info({ msg: "skipping scheduled backup", reason })
			await pool.end()
			return
		}
	}

	const backupS3Config = getBackupS3Config()
	const sentryEnabled = ensureSentryInitialized()
	const s3Client = new S3Client({
		region: backupS3Config.region,
		endpoint: backupS3Config.endpoint,
		credentials: {
			accessKeyId: backupS3Config.accessKey,
			secretAccessKey: backupS3Config.secretKey,
		},
		forcePathStyle: true,
	})

	const startedAt = new Date()
	const { backupId } = payload
	const { filename, localPath, s3Key } = getBackupFileData(databaseUrl, backupS3Config.keyPrefix)
	const recordId = await upsertBackupRecordForRun(db, { backupId, filename, s3Key })

	try {
		await updateBackupRecord(db, recordId, {
			status: BackupStatus.in_progress,
			startedAt,
		})

		logger.info({ msg: "starting database backup", backupId: recordId, filename })

		await execFileAsync("pg_dump", [
			databaseUrl,
			"-Fc",
			"--no-owner",
			"--no-acl",
			"-f",
			localPath,
		])

		const fileStats = await stat(localPath)
		const upload = new Upload({
			client: s3Client,
			params: {
				Bucket: backupS3Config.bucket,
				Key: s3Key,
				Body: createReadStream(localPath),
				ContentLength: fileStats.size,
			},
			partSize: 64 * 1024 * 1024,
			leavePartsOnError: false,
		})

		await upload.done()

		await updateBackupRecord(db, recordId, {
			status: BackupStatus.completed,
			sizeBytes: String(fileStats.size),
			completedAt: new Date(),
		})

		const backupConfig = await getBackupConfig(db)
		await cleanupExpiredBackups(db, s3Client, backupS3Config, backupConfig.retentionDays)

		logger.info({
			msg: "database backup completed",
			backupId: recordId,
			filename,
			s3Key,
			sizeBytes: fileStats.size,
		})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)

		await updateBackupRecord(db, recordId, {
			status: BackupStatus.failed,
			error: errorMessage,
			completedAt: new Date(),
		})

		logger.error({
			msg: "database backup failed",
			backupId: recordId,
			error: errorMessage,
		})

		const backupConfig = await getBackupConfig(db)
		if (backupConfig.notificationEmail) {
			await sendFailureNotification(backupConfig.notificationEmail, errorMessage, filename)
		}

		if (sentryEnabled && error instanceof Error) {
			Sentry.captureException(error)
			await Sentry.flush(5000)
		}

		throw error
	} finally {
		await unlink(localPath).catch(() => undefined)
		s3Client.destroy()
		await pool.end()
	}
}
