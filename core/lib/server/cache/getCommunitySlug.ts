import { cache } from "react"
import { headers } from "next/headers"
import { getParams } from "@nimpl/getters/get-params"

import { PUBSTAR_COMMUNITY_SLUG_HEADER_NAME } from "./constants"

/**
 * Experimental and likely unstable way to get the community slug.
 *
 * Under the hood this uses `next`s undocumented (probably for a reason) asyncStaticGenerationStore api
 */
export const _experimental_getCommunitySlug = cache(() => {
	const params = getParams()

	if (!params || !params.communitySlug || typeof params.communitySlug !== "string") {
		throw new NotInCommunityError()
	}

	return params.communitySlug
})

export class NotInCommunityError extends Error {
	message =
		"Unexpected use of `getCommunitySlug` outside of a community route. You can only use this function in a route that is scoped under a community, i.e. `/c/[communitySlug]` or `/api/v0/c/[communitySlug]`."
}

/**
 * Retrieve the community slug from headers.
 *
 * These headers are set by the middleware, so this function will only work
 * when called from a route that is scoped under a community,
 * i.e. `/c/[communitySlug]` or `/api/v0/c/[communitySlug]`.
 */
export const getCommunitySlug = cache(async () => {
	const header = await headers()
	const communitySlugHeader = header.get(PUBSTAR_COMMUNITY_SLUG_HEADER_NAME)
	if (!communitySlugHeader) {
		throw new NotInCommunityError()
	}

	return communitySlugHeader
})
