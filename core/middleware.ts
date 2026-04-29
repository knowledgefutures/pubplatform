import type { NextRequest } from "next/server"

import { NextResponse } from "next/server"

import { PUBSTAR_COMMUNITY_SLUG_HEADER_NAME } from "./lib/server/cache/constants"

const communityRouteRegexp = /^\/c\/([^/]*?)(?:$|\/)|\/api\/v\d\/c\/([^/]*?)\//

/**
 * if you are in /c/[communitySlug] or in /api/v0/c/[communitySlug],
 * we add a `pubpub_community_slug=${communitySlug}` cookie.
 * That way we can at any depth of server component/api route/server action
 * use the communitySlug to tag or invalidate cached queries.
 */
const communitySlugMiddleware = async (request: NextRequest) => {
	const matched = request.nextUrl.pathname.match(communityRouteRegexp)

	if (!matched) {
		return NextResponse.next()
	}
	const communitySlug = matched[1] || matched[2]

	if (!communitySlug) {
		// TODO: Handle strange case where no community slug is found.
		return NextResponse.next()
	}

	const response = NextResponse.next()

	response.headers.set(PUBSTAR_COMMUNITY_SLUG_HEADER_NAME, communitySlug)

	return response
}

export async function middleware(request: NextRequest) {
	const response = await communitySlugMiddleware(request)
	return response
}

export const config = {
	matcher: ["/c/:path*", "/api/v0/c/:path*"],
}
