import { createHash, randomUUID } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import pg from "pg"
import { logger } from "logger"

// arbitrary but stable id used to prevent concurrent migration runs across replicas
const ADVISORY_LOCK_ID = 72_398_241

const CREATE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
	"id"                  VARCHAR(36)  NOT NULL,
	"checksum"            VARCHAR(64)  NOT NULL,
	"finished_at"         TIMESTAMPTZ,
	"migration_name"      VARCHAR(255) NOT NULL,
	"logs"                TEXT,
	"rolled_back_at"      TIMESTAMPTZ,
	"started_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
	"applied_steps_count" INTEGER      NOT NULL DEFAULT 0,
	PRIMARY KEY ("id")
)`

async function connectWithRetry(
	connectionString: string,
	maxAttempts = 30,
	intervalMs = 2000
): Promise<pg.Client> {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const client = new pg.Client({ connectionString })

		try {
			await client.connect()
			return client
		} catch (err) {
			client.end().catch(() => {})

			if (attempt === maxAttempts) {
				throw new Error(
					`could not connect to database after ${maxAttempts} attempts: ${err}`
				)
			}

			logger.info(
				`database not ready, retrying in ${intervalMs}ms (attempt ${attempt}/${maxAttempts})...`
			)
			await new Promise((r) => setTimeout(r, intervalMs))
		}
	}

	throw new Error("unreachable")
}

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex")
}

export async function runMigrations() {
	const connectionString = process.env.DATABASE_URL
	if (!connectionString) {
		throw new Error("DATABASE_URL is required to run migrations")
	}

	// in next.js standalone mode, server.js does process.chdir(__dirname)
	// which sets cwd to the app directory (e.g. /usr/src/app/core)
	const migrationsDir = process.env.MIGRATIONS_DIR
		? resolve(process.env.MIGRATIONS_DIR)
		: resolve(process.cwd(), "prisma", "migrations")

	if (!existsSync(migrationsDir)) {
		logger.warn(`migrations directory not found at ${migrationsDir}, skipping`)
		return
	}

	logger.info(`running migrations from ${migrationsDir}`)
	const client = await connectWithRetry(connectionString)

	try {
		await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_ID])

		await client.query(CREATE_MIGRATIONS_TABLE)

		const { rows: failed } = await client.query<{ migration_name: string }>(
			`SELECT "migration_name" FROM "_prisma_migrations"
			 WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL`
		)

		if (failed.length > 0) {
			const names = failed.map((r) => r.migration_name).join(", ")
			throw new Error(
				`found migrations in a failed state that need manual resolution: ${names}. ` +
					`mark them as rolled back or delete their rows from _prisma_migrations to proceed.`
			)
		}

		const { rows: applied } = await client.query<{ migration_name: string }>(
			`SELECT "migration_name" FROM "_prisma_migrations"
			 WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`
		)
		const appliedNames = new Set(applied.map((r) => r.migration_name))

		const dirs = readdirSync(migrationsDir, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name)
			.sort()

		let count = 0

		for (const dir of dirs) {
			if (appliedNames.has(dir)) {
				continue
			}

			const sqlPath = join(migrationsDir, dir, "migration.sql")
			if (!existsSync(sqlPath)) {
				continue
			}

			const sql = readFileSync(sqlPath, "utf-8")
			const checksum = sha256(sql)
			const id = randomUUID()

			logger.info(`applying migration: ${dir}`)

			await client.query(
				`INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "started_at", "applied_steps_count")
				 VALUES ($1, $2, $3, now(), 0)`,
				[id, checksum, dir]
			)

			try {
				await client.query(sql)
			} catch (err) {
				await client.query(
					`UPDATE "_prisma_migrations" SET "logs" = $1 WHERE "id" = $2`,
					[String(err), id]
				)
				throw err
			}

			await client.query(
				`UPDATE "_prisma_migrations" SET "finished_at" = now(), "applied_steps_count" = 1 WHERE "id" = $1`,
				[id]
			)

			count++
		}

		if (count > 0) {
			logger.info(`applied ${count} migration(s)`)
		} else {
			logger.info("database is up to date, no pending migrations")
		}
	} finally {
		await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_ID]).catch(() => {})
		await client.end()
	}
}
