import { initTsrReactQuery } from "@ts-rest/react-query/v5"

import { siteApi } from "contracts"

import { env } from "./env/env"

export const client = initTsrReactQuery(siteApi, {
	baseUrl: typeof window === "undefined" ? env.PUBSTAR_URL : window.location.origin,
})

export const RETRY_COUNT = 3

export const retryPolicy = (failureCount: number, error: Error) => {
	if (!("status" in error) || typeof error.status !== "number") {
		return failureCount < RETRY_COUNT
	}

	if (error.status >= 400 && error.status < 500) {
		// unlikely such an error would resolve itself, so don't retry
		return false
	}

	return failureCount < RETRY_COUNT
}
