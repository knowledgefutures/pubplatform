"use server"

import type { JsonValue } from "contracts"
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

/**
 * Browser script injected into submission pages that dynamically fetches
 * review content by following signposting links:
 *   review page → <link rel="describedby"> → DocMap JSON → web-content URL → content
 */
const SIGNPOSTING_FETCH_SCRIPT = `<script>
(async function() {
	var items = document.querySelectorAll('[data-review-url]');
	for (var i = 0; i < items.length; i++) {
		var item = items[i];
		var url = item.getAttribute('data-review-url');
		var target = item.querySelector('.review-content-target');
		if (!url || !target) continue;
		try {
			var pageRes = await fetch(url);
			var pageHtml = await pageRes.text();
			var doc = new DOMParser().parseFromString(pageHtml, 'text/html');
			var link = doc.querySelector('link[rel="describedby"][type="application/docmap+json"]');
			if (!link) { target.innerHTML = '<em>No signposting metadata found</em>'; continue; }
			var docmapRes = await fetch(link.getAttribute('href'));
			var docmap = await docmapRes.json();
			var contentUrl = null;
			var steps = docmap.steps ? Object.values(docmap.steps) : [];
			for (var s = 0; s < steps.length && !contentUrl; s++) {
				var actions = steps[s].actions || [];
				for (var a = 0; a < actions.length && !contentUrl; a++) {
					var outputs = actions[a].outputs || [];
					for (var o = 0; o < outputs.length && !contentUrl; o++) {
						var contents = outputs[o].content || [];
						for (var c = 0; c < contents.length; c++) {
							if (contents[c].type === 'web-content') { contentUrl = contents[c].url; break; }
						}
					}
				}
			}
			if (!contentUrl) { target.innerHTML = '<em>No content URL in DocMap</em>'; continue; }
			var contentRes = await fetch(contentUrl);
			var content = await contentRes.text();
			target.style.color = ''; target.style.fontStyle = '';
			target.innerHTML = content;
		} catch (e) {
			target.innerHTML = '<em>Failed to load review content</em>';
		}
	}
})();
<\/script>`

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

		// First pass: fetch pubs and interpolate slugs for all page groups
		const pageGroupData = await Promise.all(
			config.pages.map(async (page) => {
				const query = compileJsonataQuery(page.filter)

				const pubs = await getPubsWithRelatedValues(
					{ communityId },
					{
						customFilter: (eb) => applyJsonataFilter(eb, query, { communitySlug }),
						depth: 1,
						withValues: true,
						withRelatedPubs: true,
						withPubType: true,
					}
				)

				const interpolatedPubs = await Promise.all(
					pubs.map(async (pub) => {
						const pubContext = buildInterpolationContext({
							community,
							pub,
							env: { PUBPUB_URL: env.PUBPUB_URL },
							useDummyValues: true,
						})
						const [error, slug] = await tryCatch(interpolate(page.slug, pubContext))
						if (!slug)
							logger.error({
								msg: "Error interpolating slug. Will continue with pub id.",
								err: error,
							})
						const interpolatedSlug = error ? pub.id : slug

						// Pre-render the content using the interpolation context
						const [contentError, content] = await tryCatch(
							interpolate(page.transform, pubContext)
						)
						if (contentError)
							logger.error({
								msg: "Error interpolating content",
								err: contentError,
							})

						// Interpolate headExtra if configured (e.g. <link> tags)
						const [headExtraError, headExtraValue] = page.headExtra
							? await tryCatch(interpolate(page.headExtra, pubContext))
							: [null, undefined]
						if (headExtraError)
							logger.error({
								msg: "Error interpolating headExtra",
								err: headExtraError,
							})

						// Extract source URL for cross-referencing (e.g. review's origin URL)
						const [, sourceUrlValue] = await tryCatch(
							interpolate("$.pub.values.SourceURL", pubContext)
						)

						return {
							id: pub.id,
							title: getPubTitle(pub),
							content:
								typeof content === "object" && content !== null
									? JSON.stringify(content, null, 2)
									: String(content ?? ""),
							slug: interpolatedSlug as string,
							headExtra: headExtraValue
								? String(headExtraValue)
								: undefined,
							sourceUrl: sourceUrlValue
								? String(sourceUrlValue)
								: undefined,
							// Track outgoing relations for cross-referencing
							relatedPubIds: pub.values
								.filter((v) => v.relatedPubId)
								.map((v) => v.relatedPubId!),
						}
					})
				)

				return {
					transform: page.transform,
					extension: page.extension ?? "html",
					pubs: interpolatedPubs,
				}
			})
		)

		// Inject cross-reference links and review content into pre-rendered HTML pages.
		// Reviews with a sourceUrl get a dynamic signposting fetch script;
		// reviews without one get their pre-rendered content inlined.
		for (const group of pageGroupData) {
			if (group.extension !== "html") continue
			for (const pub of group.pubs) {
				// Find pubs across ALL groups that relate TO this pub (incoming relations)
				const incomingPubs: {
					title: string
					slug: string
					content: string
					sourceUrl?: string
				}[] = []
				for (const otherGroup of pageGroupData) {
					for (const otherPub of otherGroup.pubs) {
						if (otherPub.id === pub.id) continue
						if (otherPub.relatedPubIds.includes(pub.id)) {
							incomingPubs.push({
								title: otherPub.title,
								slug: otherPub.slug,
								content: otherPub.content,
								sourceUrl: otherPub.sourceUrl,
							})
						}
					}
				}

				if (incomingPubs.length > 0) {
					const depth = pub.slug.split("/").filter(Boolean).length
					const toRoot = depth > 0 ? "../".repeat(depth) : "./"
					const hasSignposting = incomingPubs.some((p) => p.sourceUrl)

					const reviewSections = incomingPubs
						.map((p) => {
							if (p.sourceUrl) {
								// Link to the authoritative source; content fetched via signposting
								return (
									`<div class="pub-field" data-review-url="${p.sourceUrl}" style="border:1px solid var(--color-border,#e5e7eb);border-radius:0.5rem;padding:1rem;margin-bottom:1rem">` +
									`<h3><a href="${p.sourceUrl}">${p.title || "Untitled"}</a></h3>` +
									`<div class="review-content-target" style="color:var(--color-muted,#6b7280);font-style:italic">Loading review content via signposting&hellip;</div>` +
									`</div>`
								)
							}
							// Fallback: inline the pre-rendered content with local link
							return (
								`<div class="pub-field" style="border:1px solid var(--color-border,#e5e7eb);border-radius:0.5rem;padding:1rem;margin-bottom:1rem">` +
								`<h3><a href="${toRoot}${p.slug}/index.html">${p.title || "Untitled"}</a></h3>` +
								`<div>${p.content}</div>` +
								`</div>`
							)
						})
						.join("")

					pub.content += `<div class="pub-field" style="margin-top:2rem"><div class="pub-field-label">Reviews</div>${reviewSections}</div>`

					// Inject the signposting fetch script once if any review uses sourceUrl
					if (hasSignposting) {
						pub.content += SIGNPOSTING_FETCH_SCRIPT
					}
				}
			}
		}

		// Build final pages payload (pre-rendered, no transform needed)
		const pages: {
			pages: { id: string; title: string; content: string; slug: string; headExtra?: string }[]
			extension: string
		}[] = pageGroupData.map((group) => ({
			pages: group.pubs.map((pub) => ({
				id: pub.id,
				title: pub.title,
				content: pub.content,
				slug: pub.slug,
				headExtra: pub.headExtra,
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
					css: config.css,
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
