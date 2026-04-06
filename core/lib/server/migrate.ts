import type { Database } from "db/Database"
import type { PrismaMigrationsId } from "db/public"

import { createHash, randomUUID } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { Kysely, PostgresDialect, sql } from "kysely"
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

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex")
}

async function waitForDatabase(pool: pg.Pool, maxAttempts = 30, intervalMs = 2000) {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const client = await pool.connect()
			client.release()
			return
		} catch (err) {
			if (attempt === maxAttempts) {
				throw new Error(
					`could not connect to database after ${maxAttempts} attempts: ${err}`
				)
			}

			logger.info(
				`database not ready, retrying in ${intervalMs}ms (${attempt}/${maxAttempts})...`
			)
			await new Promise((r) => setTimeout(r, intervalMs))
		}
	}
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

	const shouldReset = !!process.env.DB_RESET
	const shouldSeed = !!process.env.DB_SEED

	logger.info(`running migrations from ${migrationsDir}`)

	// max: 1 ensures every operation (kysely typed queries + raw pool.query)
	// shares the same underlying connection session, keeping the advisory lock valid
	const pool = new pg.Pool({ connectionString, max: 1 })
	const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })

	try {
		await waitForDatabase(pool)

		await sql`SELECT pg_advisory_lock(${sql.lit(ADVISORY_LOCK_ID)})`.execute(db)

		if (shouldReset) {
			logger.info("resetting database (DB_RESET is set)")
			await pool.query("DROP SCHEMA public CASCADE")
			await pool.query("CREATE SCHEMA public")
		}

		// raw string query so pg uses the simple protocol (supports multi-statement sql)
		await pool.query(CREATE_MIGRATIONS_TABLE)

		const failed = await db
			.selectFrom("_prisma_migrations")
			.select("migration_name")
			.where("finished_at", "is", null)
			.where("rolled_back_at", "is", null)
			.execute()

		if (failed.length > 0) {
			const names = failed.map((r) => r.migration_name).join(", ")
			throw new Error(
				`found migrations in a failed state that need manual resolution: ${names}. ` +
					`mark them as rolled back or delete their rows from _prisma_migrations to proceed.`
			)
		}

		const applied = await db
			.selectFrom("_prisma_migrations")
			.select("migration_name")
			.where("finished_at", "is not", null)
			.where("rolled_back_at", "is", null)
			.execute()

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

			const migrationSql = readFileSync(sqlPath, "utf-8")
			const checksum = sha256(migrationSql)
			const id = randomUUID() as PrismaMigrationsId

			logger.info(`applying migration: ${dir}`)

			await db
				.insertInto("_prisma_migrations")
				.values({ id, checksum, migration_name: dir })
				.execute()

			try {
				await pool.query(migrationSql)
			} catch (err) {
				await db
					.updateTable("_prisma_migrations")
					.set({ logs: String(err) })
					.where("id", "=", id)
					.execute()
				throw err
			}

			await db
				.updateTable("_prisma_migrations")
				.set({ finished_at: new Date(), applied_steps_count: 1 })
				.where("id", "=", id)
				.execute()

			count++
		}

		if (count > 0) {
			logger.info(`applied ${count} migration(s)`)
		} else {
			logger.info("database is up to date, no pending migrations")
		}

		if (shouldSeed) {
			logger.info("running database seed (DB_SEED is set)")
			const { seed } = await import("~/prisma/seed")

			// prevents autocache from running, breaking seed
			const { withUncached } = await import("~/lib/server/cache/skipCacheStore")
			await withUncached(seed, "both")
		}

		await sql`SELECT pg_advisory_unlock(${sql.lit(ADVISORY_LOCK_ID)})`.execute(db)
	} finally {
		await db.destroy()
	}
}
