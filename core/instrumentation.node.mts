import { HoneycombSDK } from "@honeycombio/opentelemetry-node"
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node"
import * as Sentry from "@sentry/nextjs"

import { logger } from "logger"

import { env } from "./lib/env/env"

// function hook() {
logger.info("Running instrumentation hook for nodejs...")

if (env.NODE_ENV === "production" && !env.DISABLE_TELEMETRY) {
	logger.info("Instrumenting Sentry...")
	Sentry.init({
		dsn: "https://5012643b47ea6b2c8917f14442066f23@o31718.ingest.sentry.io/4505959187480576",
		environment: env.ENV_NAME,
		// Adjust this value in production, or use tracesSampler for greater control
		tracesSampleRate: 1,

		// Setting this option to true will print useful information to the console while you're setting up Sentry.
		debug: false,
		integrations: [
			Sentry.redisIntegration({
				cachePrefixes: ["nextjs:"],
			}),
		],
	})
	logger.info("✅ Successfully instrumented Sentry")
}

logger.info("Instrumenting Honeycomb...")
const sdk = new HoneycombSDK({
	instrumentations: [
		getNodeAutoInstrumentations({
			// We recommend disabling fs automatic instrumentation because
			// it can be noisy and expensive during startup
			"@opentelemetry/instrumentation-fs": {
				enabled: false,
			},
		}),
	],
})

sdk.start()
logger.info("✅ Successfully instrumented Honeycomb")

logger.info("instrumentation hooked in for nodejs.")
// }

// hook();
