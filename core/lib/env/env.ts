import type { ZodTypeAny } from "zod"

import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

import { flagsSchema } from "./flags"

const selfHostedOptional = (schema: ZodTypeAny) => {
	return process.env.SELF_HOSTED ? schema.optional() : schema
}

export const env = createEnv({
	shared: {
		NODE_ENV: z.enum(["development", "production", "test"]).optional(),
	},
	server: {
		SELF_HOSTED: z.string().optional(),
		DISABLE_TELEMETRY: z.coerce
			.boolean()
			.optional()
			.describe(
				"Whether or not to disable telemetry. By default Pubstar sends anonymous error and performance data to Honeycomb and Sentry."
			),
		API_KEY: z.string(),
		S3_BUCKET_NAME: z.string().describe("The name of the S3 bucket to use for storing assets."),
		S3_REGION: z
			.string()
			.describe(
				"The region of the S3 bucket to use for storing assets. If not known, use 'us-east-1'."
			),
		S3_ACCESS_KEY: z
			.string()
			.describe("The access key for the S3 bucket to use for storing assets."),
		S3_SECRET_KEY: z
			.string()
			.describe("The secret key for the S3 bucket to use for storing assets."),
		S3_ENDPOINT: z
			.string()
			.url()
			.optional()
			.describe(
				"The API endpoint for the S3 bucket to use for storing assets. This can differ from the public endpoint if you are using a private S3 bucket."
			),
		S3_PUBLIC_ENDPOINT: z
			.string()
			.url()
			.optional()
			.describe(
				"The public endpoint for the S3 bucket to use for storing assets. This is the endpoint that will be used to access the assets from the web, and is what your users will see when they view the assets."
			),
		S3_BACKUP_BUCKET: z.string().optional(),
		S3_BACKUP_REGION: z.string().optional(),
		S3_BACKUP_ACCESS_KEY: z.string().optional(),
		S3_BACKUP_SECRET_KEY: z.string().optional(),
		S3_BACKUP_ENDPOINT: z.string().url().optional(),
		S3_BACKUP_KEY_PREFIX: z.string().optional(),
		/**
		 * Whether or not to verbosely log `memoize` cache hits and misses
		 */
		CACHE_LOG: z.string().optional(),
		VALKEY_HOST: z.string(),
		DATABASE_URL: z.string().url(),
		ENV_NAME: z.string().optional(),
		FLAGS: flagsSchema,
		KYSELY_DEBUG: z.string().optional(),
		KYSELY_ARTIFICIAL_LATENCY: z.coerce.number().optional(),
		LOG_LEVEL: z.enum(["benchmark", "debug", "info", "warn", "error"]).optional(),
		SMTP_PASSWORD: selfHostedOptional(z.string()),
		SMTP_USERNAME: selfHostedOptional(z.string()),
		SMTP_HOST: selfHostedOptional(z.string()),
		SMTP_PORT: selfHostedOptional(z.string()),
		SMTP_FROM: selfHostedOptional(z.string().email()),
		SMTP_FROM_NAME: selfHostedOptional(z.string()),
		SMTP_SECURITY: z.enum(["ssl", "tls", "none"]).optional(),
		OTEL_SERVICE_NAME: z.string().optional(),
		HONEYCOMB_API_KEY: z.string().optional(),
		PUBSTAR_URL: z.string().url(),
		INBUCKET_URL: z.string().url().optional(),
		CI: z.string().or(z.boolean()).optional(),
		GCLOUD_KEY_FILE: selfHostedOptional(z.string()),
		DATACITE_API_URL: z.string().optional(),
		DATACITE_REPOSITORY_ID: z.string().optional(),
		DATACITE_PASSWORD: z.string().optional(),
		SENTRY_AUTH_TOKEN: z.string().optional(),
		SITE_BUILDER_ENDPOINT: selfHostedOptional(z.string().url()),
		SKIP_SEED: z.coerce.boolean().optional(),
		SKIP_RESET: z.coerce.boolean().optional(),
		DEBUG_LOADING: z.coerce.boolean().optional(),
	},
	client: {},
	experimental__runtimeEnv: {
		NODE_ENV: process.env.NODE_ENV,
	},
	skipValidation: Boolean(process.env.SKIP_VALIDATION),
	emptyStringAsUndefined: true,
})
