"use server"

import { interpolate } from "@pubstar/json-interpolate"

import { logger } from "logger"

import { getLoginData } from "~/lib/authentication/loginData"
import { env } from "~/lib/env/env"
import { getPubsWithRelatedValues } from "~/lib/server"
import { findCommunityBySlug } from "~/lib/server/community"
import { defineServerAction } from "~/lib/server/defineServerAction"
import { applyJsonataFilter, compileJsonataQuery } from "~/lib/server/jsonata-query"
import { buildInterpolationContext } from "../_lib/interpolationContext"

export const previewResult = defineServerAction(async function previewResult({
	slug,
	filter,
	transform,
	automationRunId,
}: {
	slug: string
	filter: string
	transform: string
	automationRunId: string
}) {
	const [community, loginData] = await Promise.all([findCommunityBySlug(), getLoginData()])

	if (!community) {
		throw new Error("Community not found")
	}

	if (!loginData) {
		throw new Error("Login data not found")
	}

	if (!filter) {
		throw new Error("Filter is required")
	}

	try {
		const query = compileJsonataQuery(filter)
		const pubs = await getPubsWithRelatedValues(
			{
				communityId: community.id,
			},
			{
				customFilter: (eb) =>
					applyJsonataFilter(eb, query, {
						communitySlug: community.slug,
					}),
				depth: 3,
				withValues: true,
				withRelatedPubs: true,
				limit: 5,
			}
		)

		const interpolatedPubs = await Promise.all(
			pubs.map(async (pub) => {
				const pubContext = buildInterpolationContext({
					community,
					pub,
					env: { PUBSTAR_URL: env.PUBSTAR_URL },
					useDummyValues: true,
				})
				const _interpolatedSlug = await interpolate(slug, pubContext)
				const content = await interpolate(transform, pubContext)
				return {
					id: pub.id,
					title: pub.title,
					content,
					slug: _interpolatedSlug,
				}
			})
		)

		return {
			success: true,
			pubs: interpolatedPubs,
		}
	} catch (error) {
		logger.error(error)
		return {
			success: false,
			error: error.message,
		}
	}
})
