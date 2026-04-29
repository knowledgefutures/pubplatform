import type { JobHelpers } from "graphile-worker"

import { execFile } from "node:child_process"
import { createReadStream } from "node:fs"
import { stat, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { DeleteObjectsCommand, type ObjectIdentifier, S3Client } from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import * as Sentry from "@sentry/node"
import pg from "pg"

import { logger } from "logger"

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

type BackupConfigRow = {
	enabled: boolean
	intervalHours: number
	retentionDays: number
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

const getBackupConfig = async (pool: pg.Pool): Promise<BackupConfigRow> => {
	const result = await pool.query<BackupConfigRow>(
		`select enabled, "intervalHours", "retentionDays"
		 from backup_config
		 order by "updatedAt" desc
		 limit 1`
	)

	if (!result.rows[0]) {
		return {
			enabled: false,
			intervalHours: DEFAULT_BACKUP_INTERVAL_HOURS,
			retentionDays: DEFAULT_BACKUP_RETENTION_DAYS,
		}
	}

	return result.rows[0]
}

const updateBackupRecord = async (
	pool: pg.Pool,
	backupId: string,
	{
		status,
		error,
		sizeBytes,
		startedAt,
		completedAt,
	}: {
		status: "pending" | "in_progress" | "completed" | "failed"
		error?: string | null
		sizeBytes?: string
		startedAt?: Date
		completedAt?: Date
	}
) => {
	await pool.query(
		`update backup_records
		 set
			status = $2::"BackupStatus",
			error = coalesce($3::text, error),
			"sizeBytes" = coalesce($4::bigint, "sizeBytes"),
			"startedAt" = coalesce($5::timestamptz, "startedAt"),
			"completedAt" = coalesce($6::timestamptz, "completedAt")
		 where id = $1`,
		[backupId, status, error ?? null, sizeBytes ?? null, startedAt ?? null, completedAt ?? null]
	)
}

const upsertBackupRecordForRun = async (
	pool: pg.Pool,
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
		const insertResult = await pool.query<{ id: string }>(
			`insert into backup_records (filename, "s3Key", status)
			 values ($1, $2, 'pending'::"BackupStatus")
			 returning id`,
			[filename, s3Key]
		)

		return insertResult.rows[0].id
	}

	await pool.query(
		`update backup_records
		 set filename = $2,
			"s3Key" = $3
		 where id = $1`,
		[backupId, filename, s3Key]
	)

	return backupId
}

const cleanupExpiredBackups = async (
	pool: pg.Pool,
	s3Client: S3Client,
	backupS3Config: BackupS3Config,
	retentionDays: number
) => {
	const expiredBackups = await pool.query<{ id: string; s3Key: string }>(
		`select id, "s3Key"
		 from backup_records
		 where status = 'completed'::"BackupStatus"
		 and "completedAt" is not null
		 and "completedAt" < now() - ($1::integer * interval '1 day')`,
		[retentionDays]
	)

	if (expiredBackups.rows.length === 0) {
		return
	}

	const objects = expiredBackups.rows.map((backup) => ({
		Key: backup.s3Key,
	})) satisfies ObjectIdentifier[]

	await s3Client.send(
		new DeleteObjectsCommand({
			Bucket: backupS3Config.bucket,
			Delete: {
				Objects: objects,
				Quiet: true,
			},
		})
	)

	await pool.query(`delete from backup_records where id = any($1)`, [
		expiredBackups.rows.map((backup) => backup.id),
	])
}

const scheduleNextBackup = async (helpers: JobHelpers, backupConfig: BackupConfigRow) => {
	if (!backupConfig.enabled) {
		return
	}

	const runAt = new Date(Date.now() + backupConfig.intervalHours * 60 * 60 * 1000)

	await helpers.addJob(
		"createBackup",
		{},
		{
			runAt,
			jobKey: "database-backup-scheduler",
			jobKeyMode: "replace",
		}
	)
}

const getBackupFileData = (databaseUrl: string, keyPrefix: string) => {
	const timestamp = new Date().toISOString().replace(/[:-]/g, "").split(".")[0] + "Z"
	const dbName = new URL(databaseUrl).pathname.slice(1) || "appdb"
	const filename = `${dbName}-${timestamp}.dump`
	const localPath = path.join(tmpdir(), filename)
	const normalizedPrefix = keyPrefix.replace(/\/+$/, "")
	const s3Key = `${normalizedPrefix}/${filename}`

	return {
		filename,
		localPath,
		s3Key,
	}
}

export const createBackup = async (payload: CreateBackupPayload, helpers: JobHelpers) => {
	const databaseUrl = process.env.DATABASE_URL
	if (!databaseUrl) {
		throw new Error("Missing DATABASE_URL")
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
	const pool = new pg.Pool({
		connectionString: databaseUrl,
		max: 2,
	})

	const startedAt = new Date()
	const { backupId } = payload
	const { filename, localPath, s3Key } = getBackupFileData(databaseUrl, backupS3Config.keyPrefix)
	const recordId = await upsertBackupRecordForRun(pool, {
		backupId,
		filename,
		s3Key,
	})

	try {
		await updateBackupRecord(pool, recordId, {
			status: "in_progress",
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

		await updateBackupRecord(pool, recordId, {
			status: "completed",
			sizeBytes: String(fileStats.size),
			completedAt: new Date(),
		})

		const backupConfig = await getBackupConfig(pool)
		await cleanupExpiredBackups(pool, s3Client, backupS3Config, backupConfig.retentionDays)
		await scheduleNextBackup(helpers, backupConfig)

		logger.info({
			msg: "database backup completed",
			backupId: recordId,
			filename,
			s3Key,
			sizeBytes: fileStats.size,
		})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)

		await updateBackupRecord(pool, recordId, {
			status: "failed",
			error: errorMessage,
			completedAt: new Date(),
		})

		logger.error({
			msg: "database backup failed",
			backupId: recordId,
			error: errorMessage,
		})

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
