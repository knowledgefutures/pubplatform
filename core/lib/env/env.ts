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
		API_KEY: z.string(),
		S3_BUCKET_NAME: z.string(),
		S3_REGION: z.string(),
		S3_ACCESS_KEY: z.string(),
		S3_SECRET_KEY: z.string(),
		S3_ENDPOINT: z.string().url().optional(),
		S3_PUBLIC_ENDPOINT: z.string().url().optional(),
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
		MAILGUN_SMTP_PASSWORD: selfHostedOptional(z.string()),
		MAILGUN_SMTP_USERNAME: selfHostedOptional(z.string()),
		MAILGUN_SMTP_HOST: selfHostedOptional(z.string()),
		MAILGUN_SMTP_PORT: selfHostedOptional(z.string()),
		MAILGUN_SMTP_FROM: z.string().optional(),
		MAILGUN_SMTP_FROM_NAME: z.string().optional(),
		MAILGUN_INSECURE_SENDMAIL: z.string().optional(),
		MAILGUN_SMTP_SECURITY: z.enum(["ssl", "tls", "none"]).optional(),
		OTEL_SERVICE_NAME: z.string().optional(),
		HONEYCOMB_API_KEY: z.string().optional(),
		PUBPUB_URL: z.string().url(),
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
