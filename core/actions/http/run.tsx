"use server"

import type { JsonValue } from "contracts"
import type { PubsId } from "db/public"
import type { PubValues } from "~/lib/server"
import type { action } from "./action"

import { JSONPath } from "jsonpath-plus"

import { interpolate } from "@pubpub/json-interpolate"
import { logger } from "logger"

import { env } from "~/lib/env/env"
import { updatePub } from "~/lib/server/pub"
import { defineRun } from "../types"

/**
 * extracts a value from data using either JSONPath or JSONata
 * JSONPath expressions start with $. and use bracket notation
 * JSONata expressions are everything else
 * maintains backward compatibility with existing JSONPath expressions
 */
const extractValue = async (data: unknown, expression: string): Promise<unknown> => {
	// heuristic: JSONPath uses $. prefix with bracket notation like $[...] or $.field
	// if it looks like JSONPath, use JSONPath library for backward compatibility
	const looksLikeJsonPath = expression.startsWith("$") && /^\$(\.|(\[))/.test(expression)
	if (looksLikeJsonPath) {
		const result = JSONPath({ path: expression, json: data as object, wrap: false })
		return result
	}
	// otherwise use JSONata
	return interpolate(expression, data)
}

const isAllowedHttpHost = (hostname: string, allowedDomains: string[]) => {
	const normalizedHostname = hostname.toLowerCase()

	return allowedDomains.some((allowedDomain) => {
		const normalizedDomain = allowedDomain.toLowerCase()
		const isSubdomainRule = normalizedDomain.startsWith(".")

		if (!isSubdomainRule) {
			return normalizedHostname === normalizedDomain
		}

		const domain = normalizedDomain.slice(1)
		return normalizedHostname === domain || normalizedHostname.endsWith(normalizedDomain)
	})
}

export const run = defineRun<typeof action>(async ({ pub, config, lastModifiedBy }) => {
	const { url, method, authToken } = config

	const finalOutputMap = config?.outputMap ?? []

	const parsedUrl = new URL(url)
	const isHttpProtocol = parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:"

	if (!isHttpProtocol) {
		return {
			success: false,
			title: "Error",
			error: `Invalid URL protocol "${parsedUrl.protocol}". Only http and https are allowed.`,
		}
	}

	const allowedDomains = env.FLAGS?.get("http-allowed-domains") ?? []
	const shouldRestrictDomains = allowedDomains.length > 0

	if (shouldRestrictDomains && !isAllowedHttpHost(parsedUrl.hostname, allowedDomains)) {
		return {
			success: false,
			title: "Error",
			error: `Domain "${parsedUrl.hostname}" is not allowed. Allowed domains: ${allowedDomains.join(", ")}`,
		}
	}

	const body = typeof config.body === "string" ? config.body : JSON.stringify(config.body)

	const res = await fetch(url, {
		method: method,
		headers: {
			...(authToken && { Authorization: `Bearer ${authToken}` }),
			"Content-Type": "application/json",
		},
		body,
		cache: "no-store",
	})

	if (!res.ok) {
		return {
			success: false,
			title: "Error",
			error: `Error ${res.status} ${res.statusText}`,
		}
	}

	if (
		finalOutputMap.length > 0 &&
		!res.headers.get("content-type")?.includes("application/json")
	) {
		return {
			success: false,
			title: "Error",
			error: `Expected application/json response, got ${res.headers.get("content-type")}`,
		}
	}

	const result = await res.json()

	if (!finalOutputMap || finalOutputMap.length === 0 || !pub) {
		return {
			success: true,
			report: (
				<div>
					<p>The HTTP request ran successfully without mapping</p>
					<pre>{JSON.stringify(result, null, 2)}</pre>
				</div>
			),
			data: {},
		}
	}

	const mappedOutputs = await Promise.all(
		finalOutputMap.map(async ({ pubField, responseField }) => {
			if (responseField === undefined) {
				throw new Error(`Field ${pubField} was not provided in the output map`)
			}
			const resValue = await extractValue(result, responseField)
			if (resValue === undefined || (Array.isArray(resValue) && resValue.length === 0)) {
				throw new Error(
					`Field "${responseField}" not found in response. Response was ${JSON.stringify(result)}`
				)
			}
			return { pubField, resValue }
		})
	)

	const pubValues = mappedOutputs.reduce((acc, { pubField, resValue }) => {
		acc[pubField] = resValue as JsonValue
		return acc
	}, {} as PubValues)

	try {
		await updatePub({
			pubId: pub.id as PubsId,
			communityId: pub.communityId,
			pubValues,
			continueOnValidationError: false,
			lastModifiedBy,
		})
	} catch (error) {
		logger.debug(error)
		return {
			success: false,
			title: "Error",
			error: `Failed to update fields: ${error}`,
			cause: error,
		}
	}

	return {
		success: true,
		report: (
			<div>
				<p>Successfully updated fields</p>
				<div>
					$
					{mappedOutputs
						.map(
							({ pubField, resValue }) =>
								`<p>${pubField}: ${pub.values.find((value) => value.fieldSlug === pubField)?.value} ➡️ ${resValue}</p>`
						)
						.join("\n")}
				</div>
			</div>
		),
		data: { result },
	}
})
