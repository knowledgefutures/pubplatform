import { AsyncLocalStorage } from "node:async_hooks"

import { logger } from "logger"

const SKIP_CACHE_OPTIONS = ["store", "invalidate", "both"] as const
export type SkipCacheOptions = (typeof SKIP_CACHE_OPTIONS)[number]

// tags
export const skipCacheStore = new AsyncLocalStorage<{
	/**
	 * Whether to store the result in the cache or invalidate it
	 */
	shouldSkipCache: "store" | "invalidate" | "both" | undefined
}>()

export const setSkipCacheStore = ({ shouldSkipCache }: { shouldSkipCache: SkipCacheOptions }) => {
	const store = skipCacheStore.getStore()

	if (!store) {
		logger.debug("no skip cache store found")
		return
	}

	store.shouldSkipCache = shouldSkipCache

	return store
}

/**
 * whether or not to skip the cache
 */
export const shouldSkipCache = (skipCacheOptions: SkipCacheOptions) => {
	const store = skipCacheStore.getStore()

	if (!store) {
		return false
	}

	if (store.shouldSkipCache === "both") {
		return true
	}

	return store.shouldSkipCache === skipCacheOptions
}

/**
 * wrap a function with this to skip storing and/or invalidating the cache
 * useful when outside of community contexts and you don't want to cache results
 */
export const withUncached = <T>(fn: () => Promise<T>, skipCacheOptions?: SkipCacheOptions) => {
	return skipCacheStore.run({ shouldSkipCache: skipCacheOptions ?? "invalidate" }, async () => {
		return fn()
	})
}
