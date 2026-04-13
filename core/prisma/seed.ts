import type { CommunitiesId } from "db/public"

import { makeWorkerUtils } from "graphile-worker"

import { logger } from "logger"

import { isUniqueConstraintError } from "~/kysely/errors"
import { env } from "~/lib/env/env"
import { seedBlank } from "./seeds/blank"
import { seedCoarUS1, seedCoarUS2, seedCoarUS3, seedCoarUS4 } from "./seeds/coar-notify"
import { seedLegacy } from "./seeds/legacy"
import { seedStarter } from "./seeds/starter"

const legacyId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" as CommunitiesId
const starterId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb" as CommunitiesId
const blankId = "cccccccc-cccc-4ccc-cccc-cccccccccccc" as CommunitiesId
const coarUS1Id = "dd000001-dddd-4ddd-dddd-dddddddddddd" as CommunitiesId
const coarUS2Id = "dd000002-dddd-4ddd-dddd-dddddddddddd" as CommunitiesId
const coarUS3Id = "dd000003-dddd-4ddd-dddd-dddddddddddd" as CommunitiesId
const coarUS4Id = "dd000004-dddd-4ddd-dddd-dddddddddddd" as CommunitiesId

async function main() {
	// do not seed arcadia if the minimal seed flag is set
	// this is because it will slow down ci/testing
	// this flag is set in the `globalSetup.ts` file
	// and in e2e.yml
	// eslint-disable-next-line no-restricted-properties
	const shouldSeedLegacy = !process.env.MINIMAL_SEED

	logger.info("migrate graphile")

	const workerUtils = await makeWorkerUtils({
		connectionString: env.DATABASE_URL,
	})

	logger.info("drop existing jobs")
	await workerUtils.withPgClient(async (client) => {
		await client.query(`DROP SCHEMA IF EXISTS graphile_worker CASCADE`)
	})

	await workerUtils.migrate()

	// eslint-disable-next-line no-restricted-properties
	if (process.env.SKIP_SEED) {
		logger.info("Skipping seeding...")
		return
	}

	await seedStarter(starterId)

	if (shouldSeedLegacy) {
		await seedLegacy(legacyId)
	}

	await seedBlank(blankId)

	await seedCoarUS1(coarUS1Id)
	await seedCoarUS2(coarUS2Id)
	await seedCoarUS3(coarUS3Id)
	await seedCoarUS4(coarUS4Id)
}
main()
	.then(async () => {
		logger.info("Finished seeding, exiting...")
		process.exit(0)
	})
	.catch(async (e) => {
		if (!isUniqueConstraintError(e)) {
			logger.error(e)
			process.exit(1)
		}
		logger.error(e)
		logger.info("Attempted to add duplicate entries, db is already seeded?")
	})
