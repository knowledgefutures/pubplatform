import type { autoRevalidate } from "./autoRevalidate"
import type { AutoCacheOptions, DirectAutoOutput, ExecuteFn, SQB } from "./types"

import { cache } from "react"

import { logger } from "logger"
import { tryCatch } from "utils/try-catch"

import { env } from "~/lib/env/env"
import { createCacheTag, createCommunityCacheTags } from "./cacheTags"
import { getCommunitySlug } from "./getCommunitySlug"
import { memoize } from "./memoize"
import { cachedFindTables, directAutoOutput } from "./sharedAuto"
import { shouldSkipCache as shouldSkipCacheStore } from "./skipCacheStore"
import { getTablesWithLinkedTables } from "./specialTables"
import { getTransactionStore, setTransactionStore } from "./transactionStorage"

const handleTransactionLogicAndDetermineWhetherToSkipCache = (
	revalidateTags: string[],
	asOne: string
) => {
	const transactionStore = getTransactionStore()

	if (!transactionStore?.isTransaction) {
		// we can safely use the cache
		return false
	}

	// always do this
	setTransactionStore({
		savedTags: revalidateTags,
		key: asOne,
	})

	// now we need to do something complex: if
	// if we are in a transaction and any of the tags we're saving have been invalidated
	// or if the key we're using has been used before, skip the cache
	const transactionKeys = transactionStore.keys

	if (!transactionKeys.has(asOne)) {
		// we can safely use the cache, as this key has not been used before
		return false
	}

	const toBeSavedTags = new Set(revalidateTags)
	const toBeRevalidated = transactionStore.revalidateTags

	if (toBeRevalidated.intersection(toBeSavedTags).size > 0) {
		// bypass cache and execute directly: we are otherwise likely reusing stale data, as an update has been issued
		return true
	}

	return false
}

const executeWithCache = <
	Q extends SQB<any>,
	M extends "execute" | "executeTakeFirst" | "executeTakeFirstOrThrow",
>(
	qb: Q,
	method: M,
	options?: AutoCacheOptions
) => {
	const executeFn = cache(async (...args: Parameters<Q[M]>) => {
		const compiledQuery = qb.compile()

		const willSkipCacheStore = shouldSkipCacheStore("store")
		const willSkipCacheFn = options?.skipCacheFn?.()

		const willSkipCache = willSkipCacheStore || willSkipCacheFn

		if (willSkipCache) {
			logger.debug(
				willSkipCacheStore
					? `Skipping cache for query ${compiledQuery.sql} because of skipCacheStore`
					: `Skipping cache for query ${compiledQuery.sql} because of skipCacheFn`
			)

			return qb[method](...args) as ReturnType<Q[M]>
		}

		const [error, communitySlug] = options?.communitySlug
			? [null, options.communitySlug]
			: await tryCatch(getCommunitySlug())

		if (error) {
			logger.error(`Error getting community slug: ${error.message}`)
			logger.error(compiledQuery.sql)
			throw error
		}

		const tables = await cachedFindTables(compiledQuery, "select")

		const allTables = getTablesWithLinkedTables(tables)

		const revalidateTags = [
			...createCommunityCacheTags(allTables, communitySlug),
			createCacheTag(`community-all_${communitySlug}`),
			...(options?.additionalRevalidateTags ?? []),
		]
		const additionalCacheKey = [
			...(compiledQuery.parameters as string[]),
			...(options?.additionalCacheKey ?? []),
			communitySlug,
			// very important, this is really then only thing
			// that uniquely identifies the query
			compiledQuery.sql,
		]
		const asOne = additionalCacheKey.join("|")

		const shouldSkipCache = handleTransactionLogicAndDetermineWhetherToSkipCache(
			revalidateTags,
			asOne
		)

		if (shouldSkipCache) {
			if (env.CACHE_LOG) {
				logger.debug(`AUTOCACHE: Skipping cache for query: ${asOne}`)
			}

			return qb[method](...args) as ReturnType<Q[M]>
		}

		const cachedExecute = memoize(
			async <M extends "execute" | "executeTakeFirst" | "executeTakeFirstOrThrow">(
				method: M
			) => {
				// TODO: possible improvement: just execute the compiled query rather than calling the method again
				// saves one compile cycle
				// necessary assertion here due to
				// https://github.com/microsoft/TypeScript/issues/241
				return qb[method](...args) as ReturnType<Q[M]>
			},
			{
				...options,
				revalidateTags,
				additionalCacheKey,
			}
		)

		const result = await cachedExecute(method)

		return result
	})

	// we are reaching the limit of typescript's type inference here
	// without this cast, the return type of the function
	// is missing an `Awaited`
	// possibly an instance of this 10(!) year old issue, as when
	// i leave out the type in qb[method], you get ()=>any
	// https://github.com/microsoft/TypeScript/issues/241
	return executeFn as ExecuteFn<Q, M>
}

/**
 * **✨ autoCache**
 *
 * Automagically caches and properly tags the result of a `kysely` query, scoped to a community!
 *
 * You can either pass a complete Kysely query excluding the final execute call, or a(n async)
 * function that returns a query builder as an object `{ qb: Q }`.
 *
 * See {@link autoRevalidate} for the sibling function that automatically revalidates the cache on
 * mutations.
 *
 * **Options**
 *
 * These are in addition to the same options for {@link memoize}
 *
 * **⚠️ WARNING**
 *
 * Only works in a `communitySlug` context. If you are not in a community context, so when calling this
 * from a requests originating from `/c/[communitySlug]` or `/api/v0/c/[communitySlug]`.
 *
 * If you are calling `autoCache` from outside such a context, you WILL NEED to pass the `communitySlug`
 * option to `autoCache` to make sure the cache is tagged properly.
 *
 * `autoCache` automatically retrieves the communitySlug from a header/cookie using {@link getCommunitySlug},
 * which in turn uses the `communitySlug` cookie set by middleware, which only works when in a `communitySlug` context.
 *
 * **Usage**
 *
 * _Direct usage_
 *
 * The most obvious useage is simply immediately passing the query you want to cache to `autoCache`.
 *
 * ```ts
 * const getUsersWithMemberships = autoCache(
 * 	db.selectFrom("users").select((eb) => [
 * 		"id",
 * 		"firstName",
 * 		"lastName",
 * 		"avatar",
 * 		jsonObjectAgg(
 * 			eb.selectFrom("community_memberships").selectAll("community_memberships").whereRef("community_memberships.user_id", "=", "users.id")
 * 		)
 * 			.where("community_memberships.communityId", "=", communityId)
 * 			.as("memberships"),
 * 	])
 * );
 * ```
 *
 * This returns an object with all the `execute` methods, as well as the querybuilder itself on the
 * `qb` property, should you want to extend or modify the query further.
 *
 * ```ts
 * const cachedResult = await getUsersWithMemberships.execute();
 * ```
 *
 * This will cache the query _and_ tag it properly!
 *
 * The tagging strategy is very simple: it tags every table mentioned in the query with the
 * community slug.
 *
 * For the query above, it tag the result with `community-users_${communitySlug}`,
 * `community-members_${communitySlug}`, `community-all-${communitySlug}`, and `all`.
 *
 * This works with almost any query, even recursive ones or CTEs.
 *
 * *Modifying the query*
 *
 * As mentioned above, the query builder is available on the `qb` property of the result object, so
 * you could do something like this:
 *
 * ```ts
 * const getAllUsers = autoCache(db.selectFrom("users").selectAll());
 *
 * const firstUserWithMembership = autoCache(
 * 	getAllUsers.qb.clearSelect().select((eb) => [
 * 		"id",
 *
 * 		"firstName",
 * 		"lastName",
 * 		"avatar",
 * 		jsonObjectAgg(
 * 			eb.selectFrom("community_memberships").selectAll("community_memberships").whereRef("community_memberships.user_id", "=", "users.id")
 * 		)
 * 			.where("community_id", "=", "s")
 * 			.as("memberships"),
 * 	])
 * ).executeTakeFirstOrThrow();
 * ```
 *
 * **NOTE**
 *
 * Only calling the `execute` functions returned from `autoCache` will actually cache the query! The
 * `qb` property is just a reference to the querybuilder you passed in, and will not cache the query
 * if you call `execute` on it.
 *
 * As you can see above, you will need to wrap the querybuilder in `autoCache` again to cache the
 * new query.
 *
 *
 * **How it works**
 *
 * Roughly, `autoCache` works by
 *
 * 1. Compiling the query to get the SQL and the parameters
 * 2. Finding all tables mentioned in the query
 * 3. Creating a cache key from the SQL, the parameters, and the tables
 * 4. Tagging the cache with the community slug and the tables
 * 5. Caching the result using {@link memoize}
 */
export function autoCache<Q extends SQB<any>>(
	qb: Q,
	options?: AutoCacheOptions // this kind of short-circuits typescripts type inference, while it's kind of lying as it doesn't really have anything to do what happens in the function, it's a lot faster
): DirectAutoOutput<Q> {
	return directAutoOutput(qb, executeWithCache, options)
}
