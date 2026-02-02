import type { autoCache } from "./autoCache"
import type { AutoRevalidateOptions, DirectAutoOutput, ExecuteFn, QB } from "./types"

import { revalidatePath, revalidateTag } from "next/cache"

import { logger } from "logger"

import { env } from "~/lib/env/env"
import { getCommunitySlug } from "./getCommunitySlug"
import { revalidateTagsForCommunity } from "./revalidate"
import { cachedFindTables, directAutoOutput } from "./sharedAuto"
import { shouldSkipCache as shouldSkipCacheStore } from "./skipCacheStore"
import { setTransactionStore } from "./transactionStorage"

const executeWithRevalidate = <
	Q extends QB<any>,
	M extends "execute" | "executeTakeFirst" | "executeTakeFirstOrThrow",
>(
	qb: Q,
	method: M,
	options?: AutoRevalidateOptions
) => {
	const executeFn = async (...args: Parameters<Q[M]>) => {
		const compiledQuery = qb.compile()

		const willSkipCacheStore = shouldSkipCacheStore("invalidate")

		if (willSkipCacheStore) {
			logger.debug(
				`Skipping revalidation for query ${compiledQuery.sql} because of skipCacheStore`
			)
			return qb[method](...args) as ReturnType<Q[M]>
		}

		const communitySlug = options?.communitySlug ?? (await getCommunitySlug())

		const communitySlugs = Array.isArray(communitySlug) ? communitySlug : [communitySlug]

		const tables = await cachedFindTables(compiledQuery, "mutation")

		// necessary assertion here due to
		// https://github.com/microsoft/TypeScript/issues/241
		const result = await (qb[method](...args) as ReturnType<Q[M]>)

		const additionalRevalidateTags = options?.additionalRevalidateTags ?? []

		const communityTags = await revalidateTagsForCommunity(tables, communitySlugs)

		// so we can later check whether we need to use autocache or not
		setTransactionStore({
			revalidateTags: communityTags,
		})

		additionalRevalidateTags.forEach((tag) => {
			if (env.CACHE_LOG) {
				logger.debug(`AUTOREVALIDATE: Revalidating tag: ${tag}`)
			}
			revalidateTag(tag)
		})

		if (options?.additionalRevalidatePaths) {
			options?.additionalRevalidatePaths.forEach((path) => {
				if (env.CACHE_LOG) {
					logger.debug(`AUTOREVALIDATE: Revalidating path: ${path}`)
				}
				revalidatePath(path)
			})
		}

		return result
	}

	// we are reaching the limit of typescript's type inference here
	// without this cast, the return type of the function
	// is missing an `Awaited`
	// possibly an instance of this 10(!) year old issue, as when
	// i leave out the type in qb[method], you get ()=>any
	// https://github.com/microsoft/TypeScript/issues/241
	return executeFn as ExecuteFn<Q, M>
}

/**
 * **🪄 autoRevalidate**
 *
 * Automatically revalidates the cache tags of a mutation query after it's executed.
 *
 * See {@link autoCache} for a more detailed explanation of the API.
 */
export function autoRevalidate<Q extends QB<any>>(
	qb: Q,
	options?: AutoRevalidateOptions
): DirectAutoOutput<Q> {
	return directAutoOutput(
		qb,
		executeWithRevalidate,
		// @ts-expect-error FIXME: this should just work, no clue
		// why typescript is being so difficult
		options
	)
}
