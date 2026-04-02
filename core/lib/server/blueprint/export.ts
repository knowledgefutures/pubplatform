import type { Action, CommunitiesId } from "db/public"
import type { IconConfig } from "ui/dynamic-icon"

import { jsonArrayFrom } from "kysely/helpers/postgres"

import { type AutomationConditionBlockType, ElementType } from "db/public"

import type {
	Blueprint,
	BlueprintActionConfigDefault,
	BlueprintApiToken,
	BlueprintAutomation,
	BlueprintConditionItem,
	BlueprintExportOptions,
	BlueprintForm,
	BlueprintFormElement,
	BlueprintPub,
	BlueprintPubField,
	BlueprintStage,
	BlueprintUserSlot,
	BlueprintWarning,
} from "./types"

import { db } from "~/kysely/database"
import { slugifyString } from "~/lib/string"
import { createEmptyEntityLookup, rewriteConfigToNames } from "./configRewriter"
import { BLUEPRINT_VERSION } from "./types"

type ConditionBlockItem =
	| { kind: "condition"; type: "jsonata"; expression: string }
	| { kind: "block"; type: AutomationConditionBlockType; items: ConditionBlockItem[] }

const transformConditionItems = (items: ConditionBlockItem[]): BlueprintConditionItem[] =>
	items.map((item) => {
		if (item.kind === "condition") {
			return {
				kind: "condition" as const,
				type: "jsonata" as const,
				expression: item.expression,
			}
		}
		return {
			kind: "block" as const,
			type: item.type,
			items: transformConditionItems(item.items),
		}
	})

export const exportBlueprint = async (
	communityId: CommunitiesId,
	options: BlueprintExportOptions = {}
): Promise<{ blueprint: Blueprint; warnings: BlueprintWarning[] }> => {
	const {
		includePubs = false,
		includeApiTokens = false,
		includeActionConfigDefaults = false,
	} = options

	const allWarnings: BlueprintWarning[] = []

	const community = await db
		.selectFrom("communities")
		.select(["name", "slug", "avatar"])
		.where("id", "=", communityId)
		.executeTakeFirstOrThrow()

	// pub fields
	const pubFields = await db
		.selectFrom("pub_fields")
		.select(["id", "name", "schemaName", "isRelation", "slug"])
		.where("communityId", "=", communityId)
		.execute()

	const pubFieldsBlueprint: Record<string, BlueprintPubField> = {}
	for (const field of pubFields) {
		if (!field.schemaName) continue
		pubFieldsBlueprint[field.name] = {
			schemaName: field.schemaName,
			...(field.isRelation ? { relation: true as const } : {}),
		}
	}

	// pub types
	const pubTypes = await db
		.selectFrom("pub_types")
		.select(["pub_types.id", "pub_types.name"])
		.select((eb) =>
			jsonArrayFrom(
				eb
					.selectFrom("_PubFieldToPubType")
					.innerJoin("pub_fields", "pub_fields.id", "_PubFieldToPubType.A")
					.select(["pub_fields.name", "_PubFieldToPubType.isTitle"])
					.whereRef("_PubFieldToPubType.B", "=", "pub_types.id")
			).as("fields")
		)
		.where("communityId", "=", communityId)
		.execute()

	const pubTypesBlueprint: Record<string, Record<string, { isTitle: boolean }>> = {}
	for (const pubType of pubTypes) {
		pubTypesBlueprint[pubType.name] = {}
		for (const field of pubType.fields) {
			pubTypesBlueprint[pubType.name][field.name] = { isTitle: field.isTitle }
		}
	}

	// stages
	const stages = await db
		.selectFrom("stages")
		.select(["stages.id", "stages.name"])
		.where("communityId", "=", communityId)
		.orderBy("stages.order", "asc")
		.execute()

	// build entity lookup for config rewriting
	const lookup = createEmptyEntityLookup()
	for (const stage of stages) {
		lookup.stages.set(stage.id, stage.name)
	}
	for (const field of pubFields) {
		lookup.fields.set(field.id, field.name)
	}

	// members lookup: fetch community members
	const members = await db
		.selectFrom("community_memberships")
		.innerJoin("users", "users.id", "community_memberships.userId")
		.select([
			"users.id",
			"users.slug",
			"users.firstName",
			"users.lastName",
			"users.email",
			"community_memberships.role",
		])
		.where("community_memberships.communityId", "=", communityId)
		.execute()

	for (const member of members) {
		lookup.members.set(member.id, member.slug)
	}

	// automations
	const automations = await db
		.selectFrom("automations")
		.select([
			"automations.id",
			"automations.name",
			"automations.stageId",
			"automations.icon",
			"automations.conditionEvaluationTiming",
			"automations.resolver",
		])
		.select((eb) => [
			jsonArrayFrom(
				eb
					.selectFrom("automation_triggers")
					.select([
						"automation_triggers.event",
						"automation_triggers.config",
						"automation_triggers.sourceAutomationId",
					])
					.whereRef("automation_triggers.automationId", "=", "automations.id")
			).as("triggers"),
			jsonArrayFrom(
				eb
					.selectFrom("action_instances")
					.select(["action_instances.action", "action_instances.config"])
					.whereRef("action_instances.automationId", "=", "automations.id")
					.orderBy("action_instances.createdAt", "asc")
			).as("actions"),
			jsonArrayFrom(
				eb
					.selectFrom("automation_condition_blocks")
					.select(["automation_condition_blocks.type", "automation_condition_blocks.id"])
					.whereRef("automation_condition_blocks.automationId", "=", "automations.id")
					.where("automation_condition_blocks.automationConditionBlockId", "is", null)
			).as("conditionBlocks"),
		])
		.where("communityId", "=", communityId)
		.execute()

	const automationIdToName = new Map<string, string>()
	for (const automation of automations) {
		automationIdToName.set(automation.id, automation.name)
	}

	// condition items
	const conditionBlockIds = automations
		.flatMap((a) => a.conditionBlocks)
		.map((cb) => cb.id)

	const conditionItemsMap = new Map<string, ConditionBlockItem[]>()
	if (conditionBlockIds.length > 0) {
		const conditions = await db
			.selectFrom("automation_conditions")
			.select(["automationConditionBlockId", "type", "expression"])
			.where("automationConditionBlockId", "in", conditionBlockIds)
			.execute()

		for (const condition of conditions) {
			const items = conditionItemsMap.get(condition.automationConditionBlockId) ?? []
			items.push({
				kind: "condition" as const,
				type: "jsonata" as const,
				expression: condition.expression ?? "",
			})
			conditionItemsMap.set(condition.automationConditionBlockId, items)
		}
	}

	// forms (needed for lookup before building stages)
	const forms = await db
		.selectFrom("forms")
		.innerJoin("pub_types", "pub_types.id", "forms.pubTypeId")
		.select([
			"forms.id",
			"forms.name",
			"forms.slug",
			"forms.access",
			"forms.isArchived",
			"forms.isDefault",
			"pub_types.name as pubTypeName",
		])
		.select((eb) =>
			jsonArrayFrom(
				eb
					.selectFrom("form_elements")
					.leftJoin("pub_fields", "pub_fields.id", "form_elements.fieldId")
					.select([
						"form_elements.type",
						"form_elements.component",
						"form_elements.config",
						"form_elements.content",
						"form_elements.label",
						"form_elements.element",
						"pub_fields.name as fieldName",
					])
					.select((eb) =>
						jsonArrayFrom(
							eb
								.selectFrom("_FormElementToPubType")
								.innerJoin(
									"pub_types",
									"pub_types.id",
									"_FormElementToPubType.B"
								)
								.select(["pub_types.name"])
								.whereRef("_FormElementToPubType.A", "=", "form_elements.id")
						).as("relatedPubTypes")
					)
					.whereRef("form_elements.formId", "=", "forms.id")
					.orderBy("form_elements.rank", "asc")
			).as("elements")
		)
		.where("forms.communityId", "=", communityId)
		.execute()

	for (const form of forms) {
		lookup.forms.set(form.id, form.slug)
	}

	// user slots extracted from action configs
	const userSlots: Record<string, BlueprintUserSlot> = {}

	// build stages blueprint
	const stagesBlueprint: Record<string, BlueprintStage> = {}
	for (const stage of stages) {
		const stageAutomations = automations.filter((a) => a.stageId === stage.id)

		const automationsBlueprint: Record<string, BlueprintAutomation> = {}
		for (const automation of stageAutomations) {
			const conditionBlock = automation.conditionBlocks[0]
			let condition: BlueprintAutomation["condition"] = undefined

			if (conditionBlock) {
				const items = conditionItemsMap.get(conditionBlock.id) ?? []
				condition = {
					type: conditionBlock.type,
					items: transformConditionItems(items),
				}
			}

			// rewrite action configs from IDs to symbolic names
			const rewrittenActions = automation.actions.map((a) => {
				const rawConfig = (a.config ?? {}) as Record<string, unknown>
				const { config: rewritten, warnings } = rewriteConfigToNames(
					a.action as Action,
					rawConfig,
					lookup
				)
				allWarnings.push(...warnings)

						return {
					action: a.action as Action,
					config: rewritten,
				}
			})

			automationsBlueprint[automation.name] = {
				...(automation.icon ? { icon: automation.icon as IconConfig } : {}),
				...(automation.conditionEvaluationTiming
					? { timing: automation.conditionEvaluationTiming }
					: {}),
				...(automation.resolver ? { resolver: automation.resolver } : {}),
				...(condition ? { condition } : {}),
				triggers: automation.triggers.map((t) => ({
					event: t.event,
					config: t.config as Record<string, unknown>,
					...(t.sourceAutomationId
						? { sourceAutomation: automationIdToName.get(t.sourceAutomationId) }
						: {}),
				})),
				actions: rewrittenActions,
			}
		}

		stagesBlueprint[stage.name] = {
			...(Object.keys(automationsBlueprint).length > 0
				? { automations: automationsBlueprint }
				: {}),
		}
	}

	// stage connections
	const moveConstraints = await db
		.selectFrom("move_constraint")
		.innerJoin("stages as source", "source.id", "move_constraint.stageId")
		.innerJoin("stages as dest", "dest.id", "move_constraint.destinationId")
		.select(["source.name as sourceName", "dest.name as destName"])
		.where("source.communityId", "=", communityId)
		.execute()

	const stageConnectionsBlueprint: Record<string, { to?: string[] }> = {}
	for (const constraint of moveConstraints) {
		if (!stageConnectionsBlueprint[constraint.sourceName]) {
			stageConnectionsBlueprint[constraint.sourceName] = {}
		}
		if (!stageConnectionsBlueprint[constraint.sourceName].to) {
			stageConnectionsBlueprint[constraint.sourceName].to = []
		}
		stageConnectionsBlueprint[constraint.sourceName].to!.push(constraint.destName)
	}

	// forms blueprint
	const formsBlueprint: Record<string, BlueprintForm> = {}
	for (const form of forms) {
		const elements: BlueprintFormElement[] = form.elements.map((el) => {
			if (el.type === ElementType.pubfield) {
				return {
					type: ElementType.pubfield,
					field: el.fieldName ?? "",
					component: el.component,
					config: (el.config ?? {}) as Record<string, unknown>,
					...(el.relatedPubTypes.length > 0
						? { relatedPubTypes: el.relatedPubTypes.map((rpt) => rpt.name) }
						: {}),
				}
			}
			if (el.type === ElementType.structural) {
				return {
					type: ElementType.structural,
					element: el.element!,
					content: el.content ?? "",
				}
			}
			const config = el.config as Record<string, unknown> | null
			const stageId = config?.stageId as string | undefined
			const stageName = stages.find((s) => s.id === stageId)?.name ?? ""
			return {
				type: ElementType.button,
				label: el.label ?? "",
				content: el.content ?? "",
				stage: stageName,
			}
		})

		formsBlueprint[form.name] = {
			pubType: form.pubTypeName,
			...(form.slug ? { slug: form.slug } : {}),
			...(form.access ? { access: form.access } : {}),
			...(form.isArchived ? { isArchived: form.isArchived } : {}),
			...(form.isDefault ? { isDefault: form.isDefault } : {}),
			elements,
		}
	}

	// extract user slots from members who are referenced in action configs
	for (const member of members) {
		const slug = member.slug
		// only include as a slot if referenced somewhere
		const isReferenced = allWarnings.some(
			(w) => w.message.includes(member.id)
		)
		if (isReferenced) {
			userSlots[slug] = {
				role: member.role,
				description: `${member.firstName} ${member.lastName} (${member.email})`,
			}
		}
	}

	// build blueprint
	const blueprint: Blueprint = {
		version: BLUEPRINT_VERSION,
		community: {
			name: community.name,
			slug: community.slug,
			...(community.avatar ? { avatar: community.avatar } : {}),
		},
	}

	if (Object.keys(pubFieldsBlueprint).length > 0) {
		blueprint.pubFields = pubFieldsBlueprint
	}

	if (Object.keys(pubTypesBlueprint).length > 0) {
		blueprint.pubTypes = pubTypesBlueprint
	}

	if (Object.keys(stagesBlueprint).length > 0) {
		blueprint.stages = stagesBlueprint
	}

	if (Object.keys(stageConnectionsBlueprint).length > 0) {
		blueprint.stageConnections = stageConnectionsBlueprint
	}

	if (Object.keys(formsBlueprint).length > 0) {
		blueprint.forms = formsBlueprint
	}

	if (Object.keys(userSlots).length > 0) {
		blueprint.userSlots = userSlots
	}

	if (includePubs) {
		const pubsBlueprint = await exportPubs(communityId, pubTypes, stages, pubFields)
		if (Object.keys(pubsBlueprint).length > 0) {
			blueprint.pubs = pubsBlueprint
		}
	}

	if (includeApiTokens) {
		const apiTokensBlueprint = await exportApiTokens(communityId)
		if (Object.keys(apiTokensBlueprint).length > 0) {
			blueprint.apiTokens = apiTokensBlueprint
		}
	}

	if (includeActionConfigDefaults) {
		const actionConfigDefaultsBlueprint = await exportActionConfigDefaults(communityId)
		if (actionConfigDefaultsBlueprint.length > 0) {
			blueprint.actionConfigDefaults = actionConfigDefaultsBlueprint
		}
	}

	return { blueprint, warnings: allWarnings }
}

const exportPubs = async (
	communityId: CommunitiesId,
	pubTypes: Array<{ id: string; name: string }>,
	stages: Array<{ id: string; name: string }>,
	_pubFields: Array<{ id: string; name: string; slug: string }>
): Promise<Record<string, BlueprintPub>> => {
	const pubTypeIdToName = new Map(pubTypes.map((pt) => [pt.id, pt.name]))
	const stageIdToName = new Map(stages.map((s) => [s.id, s.name]))

	const pubs = await db
		.selectFrom("pubs")
		.select(["pubs.id", "pubs.pubTypeId"])
		.select((eb) => [
			jsonArrayFrom(
				eb
					.selectFrom("pub_values")
					.innerJoin("pub_fields", "pub_fields.id", "pub_values.fieldId")
					.select([
						"pub_fields.name as fieldName",
						"pub_values.value",
						"pub_values.relatedPubId",
					])
					.whereRef("pub_values.pubId", "=", "pubs.id")
			).as("values"),
			jsonArrayFrom(
				eb
					.selectFrom("PubsInStages")
					.select(["stageId"])
					.whereRef("PubsInStages.pubId", "=", "pubs.id")
			).as("stages"),
		])
		.where("pubs.communityId", "=", communityId)
		.execute()

	// build a pub id -> key mapping
	const pubIdToKey = new Map<string, string>()
	for (let i = 0; i < pubs.length; i++) {
		const pub = pubs[i]
		const pubTypeName = pubTypeIdToName.get(pub.pubTypeId)
		const titleValue = pub.values.find((v) => v.fieldName === "Title")
		const keyBase = titleValue?.value
			? slugifyString(String(titleValue.value)).slice(0, 40)
			: `${(pubTypeName ?? "pub").toLowerCase()}-${i}`
		// ensure uniqueness
		let key = keyBase
		let suffix = 2
		while ([...pubIdToKey.values()].includes(key)) {
			key = `${keyBase}-${suffix++}`
		}
		pubIdToKey.set(pub.id, key)
	}

	const result: Record<string, BlueprintPub> = {}
	for (const pub of pubs) {
		const pubTypeName = pubTypeIdToName.get(pub.pubTypeId)
		if (!pubTypeName) continue

		const key = pubIdToKey.get(pub.id)!
		const stageId = pub.stages[0]?.stageId
		const stageName = stageId ? stageIdToName.get(stageId) : undefined

		const values: Record<string, unknown> = {}
		const relatedPubs: Record<string, Array<{ value: unknown; ref: string }>> = {}

		for (const val of pub.values) {
			if (val.relatedPubId) {
				if (!relatedPubs[val.fieldName]) {
					relatedPubs[val.fieldName] = []
				}
				const refKey = pubIdToKey.get(val.relatedPubId)
				relatedPubs[val.fieldName].push({
					value: val.value,
					ref: refKey ?? val.relatedPubId,
				})
			} else {
				values[val.fieldName] = val.value
			}
		}

		result[key] = {
			pubType: pubTypeName,
			values,
			...(stageName ? { stage: stageName } : {}),
			...(Object.keys(relatedPubs).length > 0 ? { relatedPubs } : {}),
		}
	}

	return result
}

const exportApiTokens = async (
	communityId: CommunitiesId
): Promise<Record<string, BlueprintApiToken>> => {
	const tokens = await db
		.selectFrom("api_access_tokens")
		.select(["name", "description"])
		.select((eb) =>
			jsonArrayFrom(
				eb
					.selectFrom("api_access_permissions")
					.select(["scope", "accessType", "constraints"])
					.whereRef(
						"api_access_permissions.apiAccessTokenId",
						"=",
						"api_access_tokens.id"
					)
			).as("permissions")
		)
		.where("communityId", "=", communityId)
		.execute()

	const result: Record<string, BlueprintApiToken> = {}
	for (const token of tokens) {
		const permissions: Record<string, unknown> = {}
		for (const perm of token.permissions) {
			if (!permissions[perm.scope]) {
				permissions[perm.scope] = {}
			}
			;(permissions[perm.scope] as Record<string, unknown>)[perm.accessType] =
				perm.constraints
		}

		result[token.name] = {
			...(token.description ? { description: token.description } : {}),
			permissions: Object.keys(permissions).length > 0 ? permissions : true,
		}
	}

	return result
}

const exportActionConfigDefaults = async (
	communityId: CommunitiesId
): Promise<BlueprintActionConfigDefault[]> => {
	const defaults = await db
		.selectFrom("action_config_defaults")
		.select(["action", "config"])
		.where("communityId", "=", communityId)
		.execute()

	return defaults.map((d) => ({
		action: d.action,
		config: (d.config ?? {}) as Record<string, unknown>,
	}))
}
