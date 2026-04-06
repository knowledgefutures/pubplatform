/* eslint-disable no-restricted-properties */
import type { InstrumentationOnRequestError } from "next/dist/server/instrumentation/types"

import { logger } from "logger"

export async function register() {
	if (process.env.NEXT_RUNTIME === "edge") {
		if (process.env.NODE_ENV === "development") {
			logger.info(
				"NEXT_RUNTIME is `edge` and NODE_ENV is `development`; skipping OTEL + Sentry registration."
			)
			return
		}
		await import("./instrumentation.edge.mts")
		return
	}

	logger.info(`Registering instrumentation hook for ${process.env.NEXT_RUNTIME}`)

	if (process.env.NEXT_RUNTIME === "nodejs") {
		if (process.env.NODE_ENV === "development") {
			logger.info(
				"NEXT_RUNTIME is `nodejs` and NODE_ENV is `development`; skipping OTEL + Sentry registration."
			)
			return
		}

		if (!process.env.SKIP_MIGRATIONS) {
			const { runMigrations } = await import("./lib/server/migrate")
			await runMigrations()
		}

		await import("./instrumentation.node.mts")
	} else {
		logger.info("NEXT_RUNTIME is not `nodejs`; skipping OTEL registration.")
	}
}

export const onRequestError: InstrumentationOnRequestError = async (...args) => {
	// necessary in order to avoid OOM errors on build due to Sentry making it
	// hard for webpack to optimize
	const onRequestError = await import("./instrumentation.onRequestError.ts")
	return onRequestError.onRequestError(...args)
}
