import type { TaskList } from "graphile-worker"

import { run } from "graphile-worker"
import pg from "pg"

import { logger } from "logger"

import { clients } from "./clients"
import { emitEvent } from "./jobs/emitEvent"

// must match the lock id used by the platform's migrate.ts
const ADVISORY_LOCK_ID = 72_398_241

const makeTaskList = (client: typeof clients): TaskList => ({
	emitEvent: emitEvent(client.internalClient),
})

async function waitForMigrations(connectionString: string, maxAttempts = 60, intervalMs = 3000) {
	const pool = new pg.Pool({ connectionString, max: 1 })

	try {
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const client = await pool.connect()

				try {
					// try to acquire the same lock the migrator holds. if we get it,
					// migrations are done. release immediately.
					await client.query(`SELECT pg_advisory_lock(${ADVISORY_LOCK_ID})`)
					await client.query(`SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID})`)
					logger.info("migration lock is free, proceeding with worker startup")
					return
				} finally {
					client.release()
				}
			} catch {
				logger.info(`waiting for migrations to complete (${attempt}/${maxAttempts})...`)
				await new Promise((r) => setTimeout(r, intervalMs))
			}
		}

		logger.warn("timed out waiting for migration lock, starting anyway")
	} finally {
		await pool.end()
	}
}

const main = async () => {
	const connectionString = process.env.DATABASE_URL
	if (!connectionString) {
		logger.error("DATABASE_URL is required")
		process.exit(1)
	}

	await waitForMigrations(connectionString)

	logger.info("Starting graphile worker...")

	try {
		const runner = await run({
			connectionString,
			concurrency: 5,
			noHandleSignals: false,
			pollInterval: 1000,
			taskList: makeTaskList(clients),
		})

		logger.info({ msg: `Successfully started graphile worker`, runner })
		await runner.promise
	} catch (err) {
		logger.error(err)
		process.exit(1)
	}
}

void main()
