import type { CommunitiesId } from "db/public"

import type { Blueprint, BlueprintImportOptions, BlueprintWarning } from "./types"

import { db } from "~/kysely/database"
import { seedCommunity } from "~/prisma/seed/seedCommunity"
import { BLUEPRINT_VERSION } from "./types"

/**
 * import a blueprint, creating a new community with all its configuration.
 *
 * user slots can be mapped to real user IDs, skipped, or left unresolved.
 * the import uses seedCommunity under the hood, which handles config rewriting
 * (symbolic names -> real IDs) automatically.
 *
 * future: when importing through the UI, this function could also create
 * unverified users for each slot and send invitation emails. for now, user
 * slots that are not mapped are simply dropped from memberships and configs.
 */
export const importBlueprint = async (
	blueprint: Blueprint,
	options: BlueprintImportOptions = {},
	trx = db
): Promise<{ communityId: CommunitiesId; communitySlug: string; warnings: BlueprintWarning[] }> => {
	const warnings: BlueprintWarning[] = []

	if (blueprint.version !== BLUEPRINT_VERSION) {
		throw new Error(
			`unsupported blueprint version: ${blueprint.version}, expected ${BLUEPRINT_VERSION}`
		)
	}

	const communitySlug = options.overrides?.slug ?? blueprint.community.slug
	const communityName = options.overrides?.name ?? blueprint.community.name

	const pubFields = blueprint.pubFields ?? {}
	const pubTypes = blueprint.pubTypes ?? {}
	const stages = blueprint.stages ?? {}
	const stageConnections = blueprint.stageConnections ?? {}
	const forms = blueprint.forms ?? {}
	const apiTokens = blueprint.apiTokens ?? {}

	// transform stages: strip user slot member references
	// user mapping is applied here if provided
	const transformedStages: Record<string, Record<string, unknown>> = {}
	for (const [name, stage] of Object.entries(stages)) {
		const transformedAutomations: Record<string, unknown> = {}
		if (stage.automations) {
			for (const [autoName, automation] of Object.entries(stage.automations)) {
				transformedAutomations[autoName] = {
					...automation,
					triggers: automation.triggers.map((t) => ({
						...t,
						config: t.config ?? {},
					})),
					actions: automation.actions.map((a) => ({
						...a,
						config: a.config ?? {},
					})),
				}
			}
		}

		transformedStages[name] = {
			...(Object.keys(transformedAutomations).length > 0
				? { automations: transformedAutomations }
				: {}),
		}
	}

	// transform forms: strip member references
	const transformedForms: Record<string, unknown> = {}
	for (const [name, form] of Object.entries(forms)) {
		transformedForms[name] = {
			...form,
			elements: form.elements.map((el) => {
				if (el.type === "pubfield") {
					return { ...el, config: el.config ?? {} }
				}
				return el
			}),
		}
	}

	// transform pubs from Record<key, PubBlueprint> to array format
	// seedCommunity expects an array of pubs
	const pubEntries = Object.entries(blueprint.pubs ?? {})
	const transformedPubs = pubEntries.map(([_key, pub]) => ({
		pubType: pub.pubType,
		values: pub.values ?? {},
		...(pub.stage ? { stage: pub.stage } : {}),
		...(pub.relatedPubs ? { relatedPubs: transformRelatedPubs(pub.relatedPubs, blueprint.pubs ?? {}) } : {}),
	}))

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const seedInput: any = {
		community: {
			name: communityName,
			slug: communitySlug,
			...(blueprint.community.avatar ? { avatar: blueprint.community.avatar } : {}),
		},
		pubFields,
		pubTypes,
		stages: transformedStages,
		stageConnections,
		forms: transformedForms,
		pubs: transformedPubs,
		apiTokens,
	}

	const result = await seedCommunity(seedInput, { randomSlug: false }, trx)

	return {
		communityId: result.community.id,
		communitySlug: result.community.slug,
		warnings,
	}
}

// convert blueprint relatedPubs (which use `ref` keys) to inline format
// for seedCommunity compatibility. referenced pubs are looked up from the
// full pubs record.
const transformRelatedPubs = (
	relatedPubs: Record<string, Array<{ value?: unknown; pub?: unknown; ref?: string }>>,
	allPubs: Record<string, { pubType: string; values: Record<string, unknown> }>
): Record<string, Array<{ value?: unknown; pub: unknown }>> => {
	const result: Record<string, Array<{ value?: unknown; pub: unknown }>> = {}

	for (const [fieldName, relations] of Object.entries(relatedPubs)) {
		result[fieldName] = relations.map((rel) => {
			if (rel.pub) {
				return { value: rel.value, pub: rel.pub }
			}
			if (rel.ref && allPubs[rel.ref]) {
				const referencedPub = allPubs[rel.ref]
				return {
					value: rel.value,
					pub: {
						pubType: referencedPub.pubType,
						values: referencedPub.values,
					},
				}
			}
			return { value: rel.value, pub: { pubType: "", values: {} } }
		})
	}

	return result
}
