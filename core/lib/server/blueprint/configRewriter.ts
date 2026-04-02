import type { Action } from "db/public"
import type z from "zod"

import { REFERENCE_TYPE_NAMES } from "~/actions/_lib/zodTypes"
import { actions } from "~/actions/api"
import type { BlueprintWarning } from "./types"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// maps from entity id to symbolic name
export type EntityLookup = {
	stages: Map<string, string>
	forms: Map<string, string>
	members: Map<string, string>
	fields: Map<string, string>
}

export const createEmptyEntityLookup = (): EntityLookup => ({
	stages: new Map(),
	forms: new Map(),
	members: new Map(),
	fields: new Map(),
})

const TYPE_TO_LOOKUP_KEY: Record<string, keyof EntityLookup> = {
	[REFERENCE_TYPE_NAMES.Stage]: "stages",
	[REFERENCE_TYPE_NAMES.FormSlug]: "forms",
	[REFERENCE_TYPE_NAMES.Member]: "members",
	[REFERENCE_TYPE_NAMES.FieldName]: "fields",
}

// unwrap optional, nullable, default, effects, preprocess wrappers to get the base type
const unwrapSchema = (schema: z.ZodTypeAny): z.ZodTypeAny => {
	const def = schema._def as Record<string, unknown>
	const typeName = def.typeName as string | undefined

	if (
		typeName === "ZodOptional" ||
		typeName === "ZodNullable" ||
		typeName === "ZodDefault"
	) {
		return unwrapSchema(def.innerType as z.ZodTypeAny)
	}

	if (typeName === "ZodEffects") {
		return unwrapSchema(def.schema as z.ZodTypeAny)
	}

	return schema
}

const isReferenceType = (typeName: string): boolean =>
	typeName in TYPE_TO_LOOKUP_KEY

// find all reference fields in a zod object schema
export const findReferenceFields = (
	schema: z.ZodObject<z.ZodRawShape>
): Array<{ path: string[]; typeName: string; lookupKey: keyof EntityLookup }> => {
	const results: Array<{ path: string[]; typeName: string; lookupKey: keyof EntityLookup }> = []
	walkSchemaForReferences(schema, [], results)
	return results
}

const walkSchemaForReferences = (
	schema: z.ZodTypeAny,
	path: string[],
	results: Array<{ path: string[]; typeName: string; lookupKey: keyof EntityLookup }>
): void => {
	const base = unwrapSchema(schema)
	const def = base._def as Record<string, unknown>
	const typeName = (def.typeName as string) ?? ""

	if (isReferenceType(typeName)) {
		results.push({
			path: [...path],
			typeName,
			lookupKey: TYPE_TO_LOOKUP_KEY[typeName],
		})
		return
	}

	if (typeName === "ZodObject") {
		const shape = (base as z.ZodObject<z.ZodRawShape>).shape
		for (const [key, value] of Object.entries(shape)) {
			walkSchemaForReferences(value as z.ZodTypeAny, [...path, key], results)
		}
		return
	}

	if (typeName === "ZodArray") {
		walkSchemaForReferences(def.type as z.ZodTypeAny, [...path, "[]"], results)
		return
	}

	// for ZodRecord, walk the value schema
	if (typeName === "ZodRecord") {
		walkSchemaForReferences(def.valueType as z.ZodTypeAny, [...path, "{}"], results)
		return
	}
}

// get a nested value from an object using a path
const getNestedValue = (obj: Record<string, unknown>, path: string[]): unknown => {
	let current: unknown = obj
	for (const key of path) {
		if (current == null || typeof current !== "object") return undefined
		if (key === "[]" || key === "{}") return current
		current = (current as Record<string, unknown>)[key]
	}
	return current
}

// set a nested value in an object using a path, returning a new object
const setNestedValue = (
	obj: Record<string, unknown>,
	path: string[],
	value: unknown
): Record<string, unknown> => {
	if (path.length === 0) return obj

	const result = { ...obj }
	const key = path[0]

	if (key === "[]" || key === "{}") return result

	if (path.length === 1) {
		result[key] = value
		return result
	}

	const nested = result[key]
	if (nested != null && typeof nested === "object" && !Array.isArray(nested)) {
		result[key] = setNestedValue(
			nested as Record<string, unknown>,
			path.slice(1),
			value
		)
	}

	return result
}

// rewrite values in a config for a single reference field, handling arrays/records
const rewriteFieldValue = (
	config: Record<string, unknown>,
	path: string[],
	lookup: Map<string, string>,
	warnings: BlueprintWarning[],
	direction: "toNames" | "toIds",
	configPath: string
): Record<string, unknown> => {
	const arrayIdx = path.indexOf("[]")
	const recordIdx = path.indexOf("{}")

	// simple scalar path with no array/record nesting
	if (arrayIdx === -1 && recordIdx === -1) {
		const currentValue = getNestedValue(config, path)
		if (typeof currentValue !== "string" || !currentValue) return config

		const resolved = lookup.get(currentValue)
		if (resolved) {
			return setNestedValue(config, path, resolved)
		}

		if (direction === "toNames" && UUID_PATTERN.test(currentValue)) {
			warnings.push({
				path: `${configPath}.${path.join(".")}`,
				message: `unresolved UUID reference: ${currentValue}`,
			})
		}
		return config
	}

	// handle array nesting: rewrite each element
	if (arrayIdx !== -1) {
		const parentPath = path.slice(0, arrayIdx)
		const childPath = path.slice(arrayIdx + 1)
		const arr = getNestedValue(config, parentPath)
		if (!Array.isArray(arr)) return config

		const rewritten = arr.map((item) => {
			if (typeof item !== "object" || item == null) return item
			const result = rewriteFieldValue(
				item as Record<string, unknown>,
				childPath,
				lookup,
				warnings,
				direction,
				configPath
			)
			return result
		})
		return setNestedValue(config, parentPath, rewritten)
	}

	return config
}

/**
 * rewrite action config references from UUIDs to symbolic names.
 * used during blueprint export.
 */
export const rewriteConfigToNames = (
	actionName: Action,
	config: Record<string, unknown>,
	lookup: EntityLookup
): { config: Record<string, unknown>; warnings: BlueprintWarning[] } => {
	const actionDef = actions[actionName]
	if (!actionDef) return { config, warnings: [] }

	const schema = actionDef.config.schema
	const refs = findReferenceFields(schema)
	const warnings: BlueprintWarning[] = []

	let result = { ...config }
	for (const ref of refs) {
		const refLookup = lookup[ref.lookupKey]
		result = rewriteFieldValue(
			result,
			ref.path,
			refLookup,
			warnings,
			"toNames",
			`${actionName}.config`
		)
	}

	// scan remaining string values for unresolved UUIDs
	scanForUnresolvedUuids(result, [], warnings, `${actionName}.config`, lookup)

	return { config: result, warnings }
}

/**
 * rewrite action config references from symbolic names to UUIDs.
 * used during blueprint import / seeding.
 */
export const rewriteConfigToIds = (
	actionName: Action,
	config: Record<string, unknown>,
	lookup: EntityLookup
): { config: Record<string, unknown>; warnings: BlueprintWarning[] } => {
	const actionDef = actions[actionName]
	if (!actionDef) return { config, warnings: [] }

	// build reverse lookup (name -> id)
	const reverseLookup: EntityLookup = {
		stages: invertMap(lookup.stages),
		forms: invertMap(lookup.forms),
		members: invertMap(lookup.members),
		fields: invertMap(lookup.fields),
	}

	const schema = actionDef.config.schema
	const refs = findReferenceFields(schema)
	const warnings: BlueprintWarning[] = []

	let result = { ...config }
	for (const ref of refs) {
		const refLookup = reverseLookup[ref.lookupKey]
		result = rewriteFieldValue(
			result,
			ref.path,
			refLookup,
			warnings,
			"toIds",
			`${actionName}.config`
		)
	}

	return { config: result, warnings }
}

const invertMap = (map: Map<string, string>): Map<string, string> => {
	const inverted = new Map<string, string>()
	for (const [k, v] of map) {
		inverted.set(v, k)
	}
	return inverted
}

// walk all string values in a config object and warn about UUIDs that weren't
// rewritten by a known reference field
const scanForUnresolvedUuids = (
	obj: unknown,
	path: string[],
	warnings: BlueprintWarning[],
	configPath: string,
	lookup: EntityLookup
): void => {
	if (typeof obj === "string") {
		if (!UUID_PATTERN.test(obj)) return

		// check if this uuid is known in any lookup
		const isKnown =
			lookup.stages.has(obj) ||
			lookup.forms.has(obj) ||
			lookup.members.has(obj) ||
			lookup.fields.has(obj)

		if (!isKnown) {
			warnings.push({
				path: `${configPath}.${path.join(".")}`,
				message: `possible unresolved UUID: ${obj}. this value may not be portable.`,
			})
		}
		return
	}

	if (Array.isArray(obj)) {
		for (let i = 0; i < obj.length; i++) {
			scanForUnresolvedUuids(obj[i], [...path, String(i)], warnings, configPath, lookup)
		}
		return
	}

	if (typeof obj === "object" && obj != null) {
		for (const [key, value] of Object.entries(obj)) {
			scanForUnresolvedUuids(value, [...path, key], warnings, configPath, lookup)
		}
	}
}
