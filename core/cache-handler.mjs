// Based on https://github.com/fortedigital/nextjs-cache-handler#full-example
/** biome-ignore-all lint/suspicious/noConsole: can't import logger here */

import { PHASE_PRODUCTION_BUILD } from "next/constants.js"
import createBufferStringHandler from "@fortedigital/nextjs-cache-handler/buffer-string-decorator"
import { Next15CacheHandler } from "@fortedigital/nextjs-cache-handler/next-15-cache-handler"
import { CacheHandler } from "@neshca/cache-handler"
import { isImplicitTag } from "@neshca/cache-handler/helpers"
import Redis from "ioredis"

var REVALIDATED_TAGS_KEY = "__revalidated_tags__"

const MAX_CACHE_ENTRY_SIZE = 1024 * 200 // 200kb, after this it's faster to just read from the db

/**
 * Creates a redis handler based on fortedigital's redis-strings handler, but using the ioredis
 * client
 *
 * @param {{ client: Redis}} props
 */
function createRedisHandler({
	client,
	keyPrefix = "",
	sharedTagsKey = "__sharedTags__",
	sharedTagsTtlKey = "__sharedTagsTtl__",
	revalidateTagQuerySize = 1e4,
}) {
	function assertClientIsReady() {
		if (client.status !== "ready") {
			// Throwing here ensures that we immediately fall back to uncached behavior, rather than
			// waiting for the command timeout
			throw new Error("Redis client is not ready yet or connection is lost.")
		}
	}
	async function revalidateTags(tag) {
		const tagsMap = /* @__PURE__ */ new Map()
		let cursor = 0
		let remoteTagsPortion
		do {
			;[cursor, remoteTagsPortion] = await client.hscan(
				keyPrefix + sharedTagsKey,
				cursor,
				"COUNT",
				revalidateTagQuerySize
			)

			for (let i = 0; i < remoteTagsPortion.length; i += 2) {
				const field = remoteTagsPortion[i]
				const value = remoteTagsPortion[i + 1]
				tagsMap.set(field, JSON.parse(value))
			}
		} while (cursor !== "0")
		const keysToDelete = []
		const tagsToDelete = []
		for (const [key, tags] of tagsMap) {
			if (tags.includes(tag)) {
				keysToDelete.push(keyPrefix + key)
				tagsToDelete.push(key)
			}
		}
		if (keysToDelete.length === 0) {
			return
		}
		await client.unlink(keysToDelete)
		const updateTagsOperation = client.hdel(keyPrefix + sharedTagsKey, tagsToDelete)
		const updateTtlOperation = client.hdel(keyPrefix + sharedTagsTtlKey, tagsToDelete)
		await Promise.all([updateTtlOperation, updateTagsOperation])
	}
	async function revalidateSharedKeys() {
		const ttlMap = /* @__PURE__ */ new Map()
		let cursor = 0
		let remoteTagsPortion
		do {
			;[cursor, remoteTagsPortion] = await client.hscan(
				keyPrefix + sharedTagsKey,
				cursor,
				"COUNT",
				revalidateTagQuerySize
			)

			for (let i = 0; i < remoteTagsPortion.length; i += 2) {
				const field = remoteTagsPortion[i]
				const value = remoteTagsPortion[i + 1]
				ttlMap.set(field, Number(value))
			}
		} while (cursor !== "0")
		const tagsAndTtlToDelete = []
		const keysToDelete = []
		for (const [key, ttlInSeconds] of ttlMap) {
			if (/* @__PURE__ */ Date.now() > ttlInSeconds * 1e3) {
				tagsAndTtlToDelete.push(key)
				keysToDelete.push(keyPrefix + key)
			}
		}
		if (tagsAndTtlToDelete.length === 0) {
			return
		}
		await client.unlink(keysToDelete)
		const updateTtlOperation = client.hdel(keyPrefix + sharedTagsTtlKey, tagsAndTtlToDelete)
		const updateTagsOperation = client.hdel(keyPrefix + sharedTagsKey, tagsAndTtlToDelete)
		await Promise.all([updateTagsOperation, updateTtlOperation])
	}
	const revalidatedTagsKey = keyPrefix + REVALIDATED_TAGS_KEY
	return {
		name: "pubstar-redis-strings",
		async get(key, { implicitTags }) {
			try {
				assertClientIsReady()
				const result = await client.get(keyPrefix + key)
				if (!result) {
					return null
				}
				const cacheValue = JSON.parse(result)
				if (!cacheValue) {
					return null
				}
				const sharedTagKeyExists = await client.hexists(keyPrefix + sharedTagsKey, key)
				if (!sharedTagKeyExists) {
					await client.unlink(keyPrefix + key)
					return null
				}
				const combinedTags = /* @__PURE__ */ new Set([...cacheValue.tags, ...implicitTags])
				if (combinedTags.size === 0) {
					return cacheValue
				}
				const revalidationTimes = await client.hmget(
					revalidatedTagsKey,
					Array.from(combinedTags)
				)
				for (const timeString of revalidationTimes) {
					if (timeString && Number.parseInt(timeString, 10) > cacheValue.lastModified) {
						await client.unlink(keyPrefix + key)
						return null
					}
				}
				return cacheValue
			} catch (err) {
				console.err("Cache get err", err)
				throw err
			}
		},
		async set(key, cacheHandlerValue) {
			try {
				assertClientIsReady()

				const stringified = JSON.stringify(cacheHandlerValue)

				if (stringified?.length > MAX_CACHE_ENTRY_SIZE) {
					console.log(
						"[CacheHandler]: Value is too large, skipping cache",
						stringified?.length,
						key
					)
					return
				}

				const lifespan = cacheHandlerValue.lifespan

				const setTagsOperation =
					cacheHandlerValue.tags.length > 0
						? client.hset(
								keyPrefix + sharedTagsKey,
								key,
								JSON.stringify(cacheHandlerValue.tags)
							)
						: void 0
				const setSharedTtlOperation = lifespan
					? client.hset(keyPrefix + sharedTagsTtlKey, key, lifespan.expireAt)
					: void 0
				await Promise.all([setTagsOperation, setSharedTtlOperation])

				if (typeof lifespan?.expireAt === "number") {
					await client.set(keyPrefix + key, stringified, "EXAT", lifespan.expireAt)
				} else {
					await client.set(keyPrefix + key, stringified)
				}
			} catch (err) {
				console.error("Cache set error", err)
				console.error(err.stack)
				throw err
			}
		},
		async revalidateTag(tag) {
			try {
				assertClientIsReady()
				if (isImplicitTag(tag)) {
					await client.hset(revalidatedTagsKey, tag, Date.now())
				}
				await Promise.all([revalidateTags(tag), revalidateSharedKeys()])
			} catch (err) {
				console.error("Cache revalidate error", err)
				throw err
			}
		},
		async delete(key) {
			await client.unlink(keyPrefix + key)
			await Promise.all([
				client.hdel(keyPrefix + sharedTagsKey, key),
				client.hdel(keyPrefix + sharedTagsTtlKey, key),
			])
		},
	}
}

async function getCacheHandlerPromise() {
	let redisClient = null
	if (PHASE_PRODUCTION_BUILD !== process.env.NEXT_PHASE) {
		try {
			redisClient = new Redis({
				host: process.env.VALKEY_HOST,
				lazyConnect: true,
				commandTimeout: 1000,
				retryStrategy: (times) => {
					if (times >= 15) {
						return
					}
					console.log("Retrying redis connection attempt:", times)
					return 2 ** times + Math.random() * 1000
				},
			})

			await redisClient.connect()
			console.log("Successfully connected to redis for caching")
			redisClient.on("error", (err) => {
				console.error("Cache error:", err)
			})
		} catch (err) {
			console.error("Failed to create Redis client:", err)
		}
	}
	if (redisClient?.status !== "ready") {
		console.error("Failed to initialize caching layer.")
	}

	const redisCacheHandler = createBufferStringHandler(
		createRedisHandler({
			client: redisClient,
			keyPrefix: "nextjs:",
		})
	)

	global.cacheHandlerConfigPromise = null

	global.cacheHandlerConfig = {
		handlers: [redisCacheHandler],
	}

	return global.cacheHandlerConfig
}

// Usual onCreation from @neshca/cache-handler
CacheHandler.onCreation(() => {
	// Important - It's recommended to use global scope to ensure only one Redis connection is made
	// This ensures only one instance get created
	if (global.cacheHandlerConfig) {
		return global.cacheHandlerConfig
	}

	// Important - It's recommended to use global scope to ensure only one Redis connection is made
	// This ensures new instances are not created in a race condition
	if (global.cacheHandlerConfigPromise) {
		return global.cacheHandlerConfigPromise
	}

	// Main promise initializing the handler
	global.cacheHandlerConfigPromise = getCacheHandlerPromise()

	return global.cacheHandlerConfigPromise
})

export default new Next15CacheHandler()
