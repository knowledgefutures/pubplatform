import type { Blueprint } from "./types"

// maps of string enum values to their import paths
const ENUM_IMPORTS: Record<string, { module: string; enum: string }> = {
	String: { module: "db/public", enum: "CoreSchemaType" },
	Boolean: { module: "db/public", enum: "CoreSchemaType" },
	DateTime: { module: "db/public", enum: "CoreSchemaType" },
	Email: { module: "db/public", enum: "CoreSchemaType" },
	FileUpload: { module: "db/public", enum: "CoreSchemaType" },
	Integer: { module: "db/public", enum: "CoreSchemaType" },
	MemberId: { module: "db/public", enum: "CoreSchemaType" },
	Null: { module: "db/public", enum: "CoreSchemaType" },
	Number: { module: "db/public", enum: "CoreSchemaType" },
	NumericArray: { module: "db/public", enum: "CoreSchemaType" },
	RichText: { module: "db/public", enum: "CoreSchemaType" },
	StringArray: { module: "db/public", enum: "CoreSchemaType" },
	URL: { module: "db/public", enum: "CoreSchemaType" },
	Vector3: { module: "db/public", enum: "CoreSchemaType" },
	Color: { module: "db/public", enum: "CoreSchemaType" },

	admin: { module: "db/public", enum: "MemberRole" },
	editor: { module: "db/public", enum: "MemberRole" },
	contributor: { module: "db/public", enum: "MemberRole" },

	pubEnteredStage: { module: "db/public", enum: "AutomationEvent" },
	pubLeftStage: { module: "db/public", enum: "AutomationEvent" },
	manual: { module: "db/public", enum: "AutomationEvent" },
	webhook: { module: "db/public", enum: "AutomationEvent" },
	schedule: { module: "db/public", enum: "AutomationEvent" },
	pubInStageDuration: { module: "db/public", enum: "AutomationEvent" },

	pubfield: { module: "db/public", enum: "ElementType" },
	structural: { module: "db/public", enum: "ElementType" },
	button: { module: "db/public", enum: "ElementType" },
}

// known action names mapped to their enum member
const ACTION_NAMES = new Set([
	"move",
	"email",
	"createPub",
	"http",
	"log",
	"pushToV6",
	"googleDriveImport",
	"dataCiteDeposit",
	"buildSite",
	"pdf",
	"archive",
])

/**
 * generate a TypeScript seed file from a blueprint.
 *
 * the generated file can be dropped into `core/prisma/seeds/` and will call
 * `seedCommunity` with the blueprint data, using proper TS enum imports for
 * readability.
 */
export const blueprintToSeedTs = (blueprint: Blueprint): string => {
	const usedEnums = new Set<string>()
	const usedActions = new Set<string>()

	// pre-scan to collect which enums are needed
	collectEnums(blueprint, usedEnums, usedActions)

	const lines: string[] = []

	// imports
	lines.push(`import type { CommunitiesId } from "db/public"`)
	lines.push("")

	const dbPublicImports = new Set<string>()
	for (const value of usedEnums) {
		const info = ENUM_IMPORTS[value]
		if (info) {
			dbPublicImports.add(info.enum)
		}
	}
	if (usedActions.size > 0) {
		dbPublicImports.add("Action")
	}

	if (dbPublicImports.size > 0) {
		const sorted = [...dbPublicImports].sort()
		lines.push(`import { ${sorted.join(", ")} } from "db/public"`)
		lines.push("")
	}

	lines.push(`import { seedCommunity } from "../seed/seedCommunity"`)
	lines.push("")

	// function
	const funcName = `seed${toPascalCase(blueprint.community.slug)}`
	lines.push(`export async function ${funcName}(communityId?: CommunitiesId) {`)
	lines.push(`\treturn seedCommunity(`)
	lines.push(`\t\t{`)

	// community
	lines.push(`\t\t\tcommunity: {`)
	lines.push(`\t\t\t\tid: communityId,`)
	lines.push(`\t\t\t\tname: ${JSON.stringify(blueprint.community.name)},`)
	lines.push(`\t\t\t\tslug: ${JSON.stringify(blueprint.community.slug)},`)
	if (blueprint.community.avatar) {
		lines.push(`\t\t\t\tavatar: ${JSON.stringify(blueprint.community.avatar)},`)
	}
	lines.push(`\t\t\t},`)

	// pub fields
	if (blueprint.pubFields && Object.keys(blueprint.pubFields).length > 0) {
		lines.push(`\t\t\tpubFields: {`)
		for (const [name, field] of Object.entries(blueprint.pubFields)) {
			const schemaValue = enumRef(field.schemaName, "CoreSchemaType")
			const relationPart = field.relation ? ", relation: true" : ""
			lines.push(`\t\t\t\t${safeKey(name)}: { schemaName: ${schemaValue}${relationPart} },`)
		}
		lines.push(`\t\t\t},`)
	}

	// pub types
	if (blueprint.pubTypes && Object.keys(blueprint.pubTypes).length > 0) {
		lines.push(`\t\t\tpubTypes: {`)
		for (const [name, fields] of Object.entries(blueprint.pubTypes)) {
			lines.push(`\t\t\t\t${safeKey(name)}: {`)
			for (const [fieldName, meta] of Object.entries(fields)) {
				lines.push(
					`\t\t\t\t\t${safeKey(fieldName)}: { isTitle: ${meta.isTitle} },`
				)
			}
			lines.push(`\t\t\t\t},`)
		}
		lines.push(`\t\t\t},`)
	}

	// stages
	if (blueprint.stages && Object.keys(blueprint.stages).length > 0) {
		lines.push(`\t\t\tstages: {`)
		for (const [name, stage] of Object.entries(blueprint.stages)) {
			lines.push(`\t\t\t\t${safeKey(name)}: {`)
			if (stage.automations && Object.keys(stage.automations).length > 0) {
				lines.push(`\t\t\t\t\tautomations: {`)
				for (const [autoName, automation] of Object.entries(stage.automations)) {
					lines.push(`\t\t\t\t\t\t${safeKey(autoName)}: ${serializeValue(automation, 6, usedActions)},`)
				}
				lines.push(`\t\t\t\t\t},`)
			}
			lines.push(`\t\t\t\t},`)
		}
		lines.push(`\t\t\t},`)
	}

	// stage connections
	if (
		blueprint.stageConnections &&
		Object.keys(blueprint.stageConnections).length > 0
	) {
		lines.push(
			`\t\t\tstageConnections: ${serializeValue(blueprint.stageConnections, 3, usedActions)},`
		)
	}

	// forms
	if (blueprint.forms && Object.keys(blueprint.forms).length > 0) {
		lines.push(`\t\t\tforms: ${serializeValue(blueprint.forms, 3, usedActions)},`)
	}

	lines.push(`\t\t},`)
	lines.push(`\t\t{`)
	lines.push(`\t\t\trandomSlug: false,`)
	lines.push(`\t\t}`)
	lines.push(`\t)`)
	lines.push(`}`)
	lines.push("")

	return lines.join("\n")
}

const toPascalCase = (s: string): string =>
	s
		.split(/[-_\s]+/)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join("")

const safeKey = (key: string): string =>
	/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key)

const enumRef = (value: string, enumName: string): string => {
	const info = ENUM_IMPORTS[value]
	if (info && info.enum === enumName) {
		return `${enumName}.${value}`
	}
	return JSON.stringify(value)
}

const serializeValue = (
	value: unknown,
	depth: number,
	usedActions: Set<string>
): string => {
	const indent = "\t".repeat(depth)
	const childIndent = "\t".repeat(depth + 1)

	if (value === null || value === undefined) return "undefined"
	if (typeof value === "boolean" || typeof value === "number") return String(value)
	if (typeof value === "string") {
		// check for known enum values
		const info = ENUM_IMPORTS[value]
		if (info) return `${info.enum}.${value}`

		// check for action names
		if (ACTION_NAMES.has(value) && usedActions.has(value)) {
			return `Action.${value}`
		}

		return JSON.stringify(value)
	}

	if (Array.isArray(value)) {
		if (value.length === 0) return "[]"
		const items = value.map(
			(item) => `${childIndent}${serializeValue(item, depth + 1, usedActions)},`
		)
		return `[\n${items.join("\n")}\n${indent}]`
	}

	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
		if (entries.length === 0) return "{}"
		const items = entries.map(([k, v]) => {
			// special handling for the "action" field to use Action enum
			if (k === "action" && typeof v === "string" && ACTION_NAMES.has(v)) {
				usedActions.add(v)
				return `${childIndent}${safeKey(k)}: Action.${v},`
			}
			return `${childIndent}${safeKey(k)}: ${serializeValue(v, depth + 1, usedActions)},`
		})
		return `{\n${items.join("\n")}\n${indent}}`
	}

	return JSON.stringify(value)
}

const collectEnums = (
	obj: unknown,
	usedEnums: Set<string>,
	usedActions: Set<string>
): void => {
	if (typeof obj === "string") {
		if (ENUM_IMPORTS[obj]) usedEnums.add(obj)
		if (ACTION_NAMES.has(obj)) usedActions.add(obj)
		return
	}

	if (Array.isArray(obj)) {
		for (const item of obj) {
			collectEnums(item, usedEnums, usedActions)
		}
		return
	}

	if (typeof obj === "object" && obj !== null) {
		for (const value of Object.values(obj)) {
			collectEnums(value, usedEnums, usedActions)
		}
	}
}
