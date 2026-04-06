"use server"

import type { JsonValue, ProcessedPub } from "contracts"
import type { PubsId } from "db/public"
import type { PubValues } from "~/lib/server"
import type { action } from "./action"

import { initClient } from "@ts-rest/core"
import { JSONPath } from "jsonpath-plus"

import { interpolate } from "@pubpub/json-interpolate"
import { siteBuilderApi } from "contracts/resources/site-builder-2"
import { logger } from "logger"
import { tryCatch } from "utils/try-catch"

import { env } from "~/lib/env/env"
import { getPubTitle } from "~/lib/pubs"
import { getPubsWithRelatedValues } from "~/lib/server"
import { getSiteBuilderToken } from "~/lib/server/apiAccessTokens"
import { getCommunitySlug } from "~/lib/server/cache/getCommunitySlug"
import { getCommunity } from "~/lib/server/community"
import { applyJsonataFilter, compileJsonataQuery } from "~/lib/server/jsonata-query"
import { updatePub } from "~/lib/server/pub"
import { buildInterpolationContext } from "../_lib/interpolationContext"
import { createPubProxy } from "../_lib/pubProxy"
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

		const NIL_UUID = "00000000-0000-0000-0000-000000000000"

		// Fetch pubs for all groups that have a filter
		const groupsWithPubs = await Promise.all(
			config.pages.map(async (page) => {
				if (!page.filter) return { page, pubs: [] as ProcessedPub[] }
				const query = compileJsonataQuery(page.filter)
				const pubs = await getPubsWithRelatedValues(
					{ communityId },
					{
						customFilter: (eb) => applyJsonataFilter(eb, query, { communitySlug }),
						depth: 1,
						withValues: true,
						withRelatedPubs: true,
						withPubType: true,
						withIncomingRelations: true,
					}
				)
				return { page, pubs }
			})
		)

		const stringifyContent = (content: unknown): string =>
			typeof content === "object" && content !== null
				? JSON.stringify(content, null, 2)
				: String(content ?? "")

		const computeSiteBase = (slug: string) => {
			const depth = slug.split("/").filter(Boolean).length
			return depth === 0 ? "." : Array(depth).fill("..").join("/")
		}

		// Process each page group according to its mode
		const pageGroupData = await Promise.all(
			groupsWithPubs.map(async ({ page, pubs }) => {
				const extension = page.extension ?? "html"

				// Static: no filter, no pubs — evaluate transform once with empty context
				if (!page.filter) {
					const [slugErr, slug] = await tryCatch(interpolate(page.slug, {}))
					const interpolatedSlug = (slugErr ? "static" : slug) as string
					const [contentErr, content] = await tryCatch(interpolate(page.transform, {}))
					if (contentErr)
						logger.error({ msg: "Error interpolating static page", err: contentErr })
					return {
						extension,
						pubs: [
							{
								id: NIL_UUID,
								title: interpolatedSlug,
								content: stringifyContent(content),
								slug: interpolatedSlug,
							},
						],
					}
				}

				// Single: slug doesn't reference $.pub — one page with all matched pubs as $.pubs
				const isPerPub = page.slug.includes("$.pub")
				if (!isPerPub) {
					const pubProxies = pubs.map((p) => createPubProxy(p, communitySlug))
					const context: Record<string, unknown> = {
						pubs: pubProxies,
						community: { id: community.id, name: community.name, slug: community.slug },
						env: { PUBPUB_URL: env.PUBPUB_URL },
					}
					const [slugErr, slug] = await tryCatch(interpolate(page.slug, context))
					const interpolatedSlug = (slugErr ? "index" : slug) as string
					context.site = { base: computeSiteBase(interpolatedSlug) }
					const [contentErr, content] = await tryCatch(
						interpolate(page.transform, context)
					)
					if (contentErr)
						logger.error({ msg: "Error interpolating single page", err: contentErr })
					return {
						extension,
						pubs: [
							{
								id: NIL_UUID,
								title: interpolatedSlug,
								content: stringifyContent(content),
								slug: interpolatedSlug,
							},
						],
					}
				}

				// Per-pub: one page per matched pub with $.pub in context
				const interpolatedPubs = await Promise.all(
					pubs.map(async (pub) => {
						const pubContext = buildInterpolationContext({
							community,
							pub,
							env: { PUBPUB_URL: env.PUBPUB_URL },
							useDummyValues: true,
						})
						const [slugErr, slug] = await tryCatch(interpolate(page.slug, pubContext))
						if (slugErr) logger.error({ msg: "Error interpolating slug", err: slugErr })
						const interpolatedSlug = (slugErr ? pub.id : slug) as string
						pubContext.site = { base: computeSiteBase(interpolatedSlug) }
						const [contentErr, content] = await tryCatch(
							interpolate(page.transform, pubContext)
						)
						if (contentErr)
							logger.error({ msg: "Error interpolating content", err: contentErr })
						return {
							id: pub.id,
							title: getPubTitle(pub as unknown as Parameters<typeof getPubTitle>[0]),
							content: stringifyContent(content),
							slug: interpolatedSlug,
						}
					})
				)

				return { extension, pubs: interpolatedPubs }
			})
		)
		const pages: {
			pages: { id: string; title: string; content: string; slug: string }[]
			extension: string
		}[] = pageGroupData.map((group) => ({
			pages: group.pubs.map((pub) => ({
				id: pub.id,
				title: pub.title,
				content: pub.content,
				slug: pub.slug,
			})),
			extension: group.extension,
		}))

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
			headers: {
				authorization: `Bearer ${siteBuilderToken}`,
			},
		})

		const [buildError, result] = await tryCatch(
			siteBuilderClient.build({
				body: {
					automationRunId: automationRunId,
					communitySlug,
					subpath: config.subpath,
					pages,
					siteUrl: env.PUBPUB_URL,
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
