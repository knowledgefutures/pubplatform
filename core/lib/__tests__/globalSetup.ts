/* eslint-disable no-restricted-properties */
import { spawnSync } from "node:child_process"
import { config } from "dotenv"

import { logger } from "logger"

export const setup = async () => {
	config({
		path: [
			new URL("../../.env.development", import.meta.url).pathname,
			new URL("../../.env.local", import.meta.url).pathname,
		],
	})

	if (process.env.SKIP_RESET) {
		return
	}

	logger.info("Resetting database...")
	const result = spawnSync("pnpm -F core reset-base", {
		shell: true,
		stdio: "inherit",
	})
	if (result.error) {
		logger.error(
			"Something went wrong while trying to reset the database before running tests."
		)
		throw result.error
	}
	if (result.status !== 0) {
		throw new Error(`Database reset failed with exit code ${result.status}`)
	}
	logger.info("Database reset successful")
}

export default setup
