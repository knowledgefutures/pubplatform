"use server"

import type { JsonValue } from "contracts"
import type { PageGroup } from "contracts/resources/site-builder-2"
import type { PubsId } from "db/public"
import type { PubValues } from "~/lib/server"
import type { action } from "./action"

import { interpolate } from "@pubstar/json-interpolate"
import { initClient } from "@ts-rest/core"
import { JSONPath } from "jsonpath-plus"

import { siteBuilderApi } from "contracts/resources/site-builder-2"
import { logger } from "logger"
import { tryCatch } from "utils/try-catch"

import { env } from "~/lib/env/env"
import { getPubsWithRelatedValues } from "~/lib/server"
import { getSiteBuilderToken } from "~/lib/server/apiAccessTokens"
import { getCommunitySlug } from "~/lib/server/cache/getCommunitySlug"
import { getCommunity } from "~/lib/server/community"
import { applyJsonataFilter, compileJsonataQuery } from "~/lib/server/jsonata-query"
import { updatePub } from "~/lib/server/pub"
import { defineRun } from "../types"

/**
 * extracts a value from data using either JSONPath or JSONata
 * JSONPath expressions start with $. and use bracket notation
 * JSONata expressions are everything else
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

export const run = defineRun<typeof action>(
	async ({ communityId, pub, config, automationRunId, lastModifiedBy }) => {
		const community = await getCommunity(communityId)
		const siteBuilderToken = await getSiteBuilderToken(communityId)

		if (!community) {
			throw new Error("Community not found")
		}

		if (!siteBuilderToken) {
			throw new Error("Site builder token not found")
		}

		const communitySlug = await getCommunitySlug()

		const siteBuilderClient = initClient(siteBuilderApi, {
			baseUrl: env.SITE_BUILDER_ENDPOINT!,
			headers: {
				authorization: `Bearer ${siteBuilderToken}`,
			},
		})

		// Resolve filters to pub IDs and determine mode for each page group
		const pageGroups: PageGroup[] = await Promise.all(
			config.pages.map(async (page) => {
				if (!page.filter) {
					return {
						mode: "static" as const,
						transform: page.transform,
						slugTemplate: page.slug,
						extension: page.extension ?? "html",
						pubIds: [],
					}
				}

				const query = compileJsonataQuery(page.filter)
				const pubs = await getPubsWithRelatedValues(
					{ communityId },
					{
						customFilter: (eb) => applyJsonataFilter(eb, query, { communitySlug }),
						depth: 1,
						withValues: false,
						withRelatedPubs: false,
					}
				)

				const mode = page.slug.includes("$.pub")
					? ("per-pub" as const)
					: ("single" as const)

				return {
					mode,
					transform: page.transform,
					slugTemplate: page.slug,
					extension: page.extension ?? "html",
					pubIds: pubs.map((p) => p.id),
				}
			})
		)

		const [healthError, health] = await tryCatch(siteBuilderClient.health())
		if (healthError) {
			logger.error({ msg: "Site builder server is not healthy", healthError })
			throw new Error("Site builder server cannot be reached")
		}
		if (health.status !== 200) {
			logger.error({ msg: "Site builder server is not healthy", health })
			throw new Error("Site builder server is not healthy")
		}

		logger.debug({
			msg: `Initializing site build`,
			communitySlug,
			mapping: config,
		})

		const [buildError, result] = await tryCatch(
			siteBuilderClient.build({
				body: {
					automationRunId,
					communitySlug,
					communityId,
					communityName: community.name,
					subpath: config.subpath,
					siteUrl: env.PUBSTAR_URL,
					pageGroups,
				},
				headers: {
					authorization: `Bearer ${siteBuilderToken}`,
				},
			})
		)
		if (buildError) {
			logger.error({ msg: "Failed to build journal site", buildError })
			return {
				success: false,
				title: "Failed to build journal site",
				error: buildError.message,
			}
		}

		if (result.status !== 200) {
			logger.error({ msg: "Failed to build journal site", result, status: result.status })
			throw new Error("Failed to build journal site")
		}

		const data = result.body

		logger.info({ msg: "Journal site built", data })

		const dataUrl = new URL(data.url)

		// apply output mapping if configured
		const finalOutputMap = config.outputMap ?? []
		if (finalOutputMap.length > 0 && pub) {
			try {
				const mappedOutputs = await Promise.all(
					finalOutputMap.map(async ({ pubField, responseField }) => {
						if (responseField === undefined) {
							throw new Error(`Field ${pubField} was not provided in the output map`)
						}
						const resValue = await extractValue(data, responseField)
						if (resValue === undefined) {
							throw new Error(
								`Field "${responseField}" not found in response. Response was ${JSON.stringify(data)}`
							)
						}
						return { pubField, resValue }
					})
				)

				const pubValues = mappedOutputs.reduce((acc, { pubField, resValue }) => {
					acc[pubField] = resValue as JsonValue
					return acc
				}, {} as PubValues)

				await updatePub({
					pubId: pub.id as PubsId,
					communityId: pub.communityId,
					pubValues,
					continueOnValidationError: false,
					lastModifiedBy,
				})

				const displayUrl = data.firstPageUrl || data.siteUrl || data.s3FolderUrl

				return {
					success: true as const,
					report: (
						<div>
							<p>Journal site built and pub fields updated</p>
							<p>
								<a className="font-bold underline" href={dataUrl.toString()}>
									Download ZIP
								</a>
							</p>
							{displayUrl && (
								<p>
									Site URL:{" "}
									<a className="font-bold underline" href={displayUrl}>
										{displayUrl}
									</a>
								</p>
							)}
							<p>Updated fields: {mappedOutputs.map((m) => m.pubField).join(", ")}</p>
						</div>
					),
					data: {
						...data,
						url: dataUrl.toString(),
					},
				}
			} catch (error) {
				logger.error({ msg: "Failed to update pub fields", error })
				return {
					success: false,
					title: "Site built but failed to update pub fields",
					error: `${error}`,
					data: {
						...data,
						url: dataUrl.toString(),
					},
				}
			}
		}

		const displayUrl = data.firstPageUrl || data.siteUrl || data.s3FolderUrl

		return {
			success: true as const,
			report: (
				<div>
					<p>Journal site built</p>
					<p>
						<a className="font-bold underline" href={dataUrl.toString()}>
							Download ZIP
						</a>
					</p>
					{displayUrl && (
						<p>
							Site URL:{" "}
							<a className="font-bold underline" href={displayUrl}>
								{displayUrl}
							</a>
						</p>
					)}
				</div>
			),
			data: {
				...data,
				url: dataUrl.toString(),
			},
		}
	}
)
