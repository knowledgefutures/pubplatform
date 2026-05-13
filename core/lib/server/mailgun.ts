import type SMTPPool from "nodemailer/lib/smtp-pool"

import nodemailer from "nodemailer"

import { env } from "~/lib/env/env"

let smtpclient: nodemailer.Transporter

const TLS_CONFIG = {
	secure: false,
	opportunisticTLS: true,
	tls: {
		ciphers: "SSLv3",
		rejectUnauthorized: false,
	},
} as const satisfies Partial<SMTPPool.Options>

const SSL_CONFIG = {
	secure: true,
} as const satisfies Partial<SMTPPool.Options>

const NO_CONFIG = {
	secure: false,
	opportunisticTLS: true,
} as const satisfies Partial<SMTPPool.Options>

const guessSecurityType = () => {
	if (env.SMTP_PORT === "465") {
		return "ssl"
	}

	if (env.SMTP_PORT === "587") {
		return "tls"
	}

	return "none"
}

const getSecurityConfig = () => {
	const securityType = env.SMTP_SECURITY ?? guessSecurityType()

	if (securityType === "ssl") {
		return SSL_CONFIG
	}

	if (securityType === "tls") {
		return TLS_CONFIG
	}

	return NO_CONFIG
}

export const getSmtpClient = () => {
	const securityConfig = getSecurityConfig()

	if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_USERNAME || !env.SMTP_PASSWORD) {
		throw new Error(
			"Missing required SMTP configuration. Please set SMTP_HOST, SMTP_PORT, SMTP_USERNAME, and SMTP_PASSWORD in order to send emails."
		)
	}

	if (!smtpclient) {
		smtpclient = nodemailer.createTransport({
			...securityConfig,
			pool: true,
			host: env.SMTP_HOST,
			port: parseInt(env.SMTP_PORT, 10),
			secure:
				securityConfig.secure &&
				(env.SMTP_HOST !== "localhost" || env.SMTP_HOST !== "inbucket") &&
				!env.CI,
			auth: {
				user: env.SMTP_USERNAME,
				pass: env.SMTP_PASSWORD,
			},
		})
	}

	return smtpclient
}
