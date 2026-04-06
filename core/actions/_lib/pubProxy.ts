import type { ProcessedPub } from "contracts"

// properties that should never be forwarded through the proxy
const BLOCKED_PROPS = new Set([
	"then",
	"catch",
	"finally",
	"constructor",
	"__proto__",
	"prototype",
	"$$typeof",
	"toJSON",
	"valueOf",
	"toString",
	"hasOwnProperty",
	"isPrototypeOf",
	"propertyIsEnumerable",
])

const isBlockedProp = (prop: string | symbol): boolean => {
	if (typeof prop === "symbol") return true
	return BLOCKED_PROPS.has(prop)
}

// creates a proxy that allows case-insensitive lookup but also returns the full object when iterated
const createLookupProxy = <T>(
	data: Record<string, T>,
	communitySlug: string
): Record<string, T> => {
	return new Proxy(data, {
		get(target, prop) {
			if (isBlockedProp(prop)) return undefined
			const propStr = String(prop)
			// direct match
			if (propStr in target) return target[propStr]
			// try with community prefix
			const prefixed = `${communitySlug}:${propStr}`
			if (prefixed in target) return target[prefixed]
			// try lowercase
			const lower = propStr.toLowerCase()
			if (lower in target) return target[lower]
			const prefixedLower = `${communitySlug}:${lower}`
			if (prefixedLower in target) return target[prefixedLower]
			return undefined
		},
		has(target, prop) {
			if (isBlockedProp(prop)) return false
			return prop in target
		},
		ownKeys(target) {
			return Reflect.ownKeys(target)
		},
		getOwnPropertyDescriptor(target, prop) {
			return Object.getOwnPropertyDescriptor(target, prop)
		},
	})
}

export type IncomingRelations = Record<string, ProcessedPub[]>

export const createPubProxy = (
	pub: ProcessedPub,
	communitySlug: string
): Record<string, unknown> => {
	// build plain objects for all lookups
	const fields: Record<string, true> = {}
	const values: Record<string, unknown> = {}
	const out: Record<string, Record<string, unknown>> = {}

	for (const v of pub.values) {
		const shortSlug = v.fieldSlug.replace(`${communitySlug}:`, "")
		// use short slug as primary key to avoid duplicates
		fields[shortSlug] = true
		values[shortSlug] = v.value

		if (v.relatedPub) {
			out[shortSlug] = createPubProxy(v.relatedPub, communitySlug)
		}
	}

	// build incoming relations lookup: field slug -> array of pub proxies
	const inObj: Record<string, Record<string, unknown>[]> = {}
	const incomingRelations = pub.incomingRelations
	if (incomingRelations) {
		for (const [slug, pubs] of Object.entries(incomingRelations)) {
			const shortSlug = slug.replace(`${communitySlug}:`, "")
			inObj[shortSlug] = pubs.map((p) => createPubProxy(p, communitySlug))
		}
	}

	const fieldsProxy = createLookupProxy(fields, communitySlug)
	const valuesProxy = createLookupProxy(values, communitySlug)
	const outProxy = createLookupProxy(out, communitySlug)
	const inProxy = createLookupProxy(inObj, communitySlug)

	// build the base object with all pub properties except values (which we override)
	const base: Record<string, unknown> = {}
	for (const key of Object.keys(pub)) {
		if (key === "values") continue
		base[key] = pub[key as keyof ProcessedPub]
	}

	base.fields = fieldsProxy
	base.values = valuesProxy
	base.out = outProxy
	base.in = inProxy

	return new Proxy(base, {
		get(target, prop) {
			if (isBlockedProp(prop)) return undefined
			return target[prop as string]
		},
		has(target, prop) {
			if (isBlockedProp(prop)) return false
			return prop in target
		},
		ownKeys(target) {
			return Reflect.ownKeys(target)
		},
		getOwnPropertyDescriptor(target, prop) {
			return Object.getOwnPropertyDescriptor(target, prop)
		},
	})
}
