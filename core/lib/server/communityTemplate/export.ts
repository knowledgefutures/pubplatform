import type { CommunitiesId, MemberRole, PubsId } from "db/public"
import type { IconConfig } from "ui/dynamic-icon"

import { jsonArrayFrom } from "kysely/helpers/postgres"

import { AutomationConditionBlockType, ElementType } from "db/public"

import type {
	CommunityTemplate,
	TemplateActionConfigDefault,
	TemplateApiToken,
	TemplateAutomation,
	TemplateConditionItem,
	TemplateExportOptions,
	TemplateForm,
	TemplateFormElement,
	TemplatePub,
	TemplatePubField,
	TemplateStage,
} from "./types"

import { db } from "~/kysely/database"

type ConditionBlockItem =
	| { kind: "condition"; type: "jsonata"; expression: string }
	| { kind: "block"; type: AutomationConditionBlockType; items: ConditionBlockItem[] }

const transformConditionItems = (items: ConditionBlockItem[]): TemplateConditionItem[] => {
	return items.map((item) => {
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
}

export const exportCommunityTemplate = async (
	communityId: CommunitiesId,
	options: TemplateExportOptions = {}
): Promise<CommunityTemplate> => {
	const { includePubs = false, includeApiTokens = false, includeActionConfigDefaults = false } =
		options
	// fetch community
	const community = await db
		.selectFrom("communities")
		.select(["name", "slug", "avatar"])
		.where("id", "=", communityId)
		.executeTakeFirstOrThrow()

	// fetch pub fields
	const pubFields = await db
		.selectFrom("pub_fields")
		.select(["name", "schemaName", "isRelation"])
		.where("communityId", "=", communityId)
		.execute()

	const pubFieldsTemplate: Record<string, TemplatePubField> = {}
	for (const field of pubFields) {
		if (!field.schemaName) continue
		pubFieldsTemplate[field.name] = {
			schemaName: field.schemaName,
			...(field.isRelation ? { relation: true as const } : {}),
		}
	}

	// fetch pub types with their fields
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

	const pubTypesTemplate: Record<string, Record<string, { isTitle: boolean }>> = {}
	for (const pubType of pubTypes) {
		pubTypesTemplate[pubType.name] = {}
		for (const field of pubType.fields) {
			pubTypesTemplate[pubType.name][field.name] = { isTitle: field.isTitle }
		}
	}

	// fetch stages (no members - memberships are skipped in templates)
	const stages = await db
		.selectFrom("stages")
		.select(["stages.id", "stages.name"])
		.where("communityId", "=", communityId)
		.orderBy("stages.order", "asc")
		.execute()

	// fetch automations
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
					.select([
						"action_instances.action",
						"action_instances.config",
					])
					.whereRef("action_instances.automationId", "=", "automations.id")
					.orderBy("action_instances.createdAt", "asc")
			).as("actions"),
			jsonArrayFrom(
				eb
					.selectFrom("automation_condition_blocks")
					.select([
						"automation_condition_blocks.type",
						"automation_condition_blocks.id",
					])
					.whereRef("automation_condition_blocks.automationId", "=", "automations.id")
					.where("automation_condition_blocks.automationConditionBlockId", "is", null)
			).as("conditionBlocks"),
		])
		.where("communityId", "=", communityId)
		.execute()

	// build automation id to name map for resolving sourceAutomation references
	const automationIdToName = new Map<string, string>()
	for (const automation of automations) {
		automationIdToName.set(automation.id, automation.name)
	}

	// fetch condition block items
	const conditionBlockIds = automations
		.flatMap((a) => a.conditionBlocks)
		.map((cb) => cb.id)

	let conditionItemsMap = new Map<string, ConditionBlockItem[]>()
	if (conditionBlockIds.length > 0) {
		// fetch conditions for each block
		const conditions = await db
			.selectFrom("automation_conditions")
			.select([
				"automationConditionBlockId",
				"type",
				"expression",
			])
			.where("automationConditionBlockId", "in", conditionBlockIds)
			.execute()

		// group conditions by block id
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

	// build stages template (no members - memberships are skipped in templates)
	const stagesTemplate: Record<string, TemplateStage> = {}
	for (const stage of stages) {
		const stageAutomations = automations.filter((a) => a.stageId === stage.id)

		const automationsTemplate: Record<string, TemplateAutomation> = {}
		for (const automation of stageAutomations) {
			const conditionBlock = automation.conditionBlocks[0]
			let condition: TemplateAutomation["condition"] = undefined

			if (conditionBlock) {
				const items = conditionItemsMap.get(conditionBlock.id) ?? []
				condition = {
					type: conditionBlock.type,
					items: transformConditionItems(items),
				}
			}

			automationsTemplate[automation.name] = {
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
				actions: automation.actions.map((a) => ({
					action: a.action,
					config: (a.config ?? {}) as Record<string, unknown>,
				})),
			}
		}

		stagesTemplate[stage.name] = {
			...(Object.keys(automationsTemplate).length > 0
				? { automations: automationsTemplate }
				: {}),
		}
	}

	// fetch stage connections
	const moveConstraints = await db
		.selectFrom("move_constraint")
		.innerJoin("stages as source", "source.id", "move_constraint.stageId")
		.innerJoin("stages as dest", "dest.id", "move_constraint.destinationId")
		.select(["source.name as sourceName", "dest.name as destName"])
		.where("source.communityId", "=", communityId)
		.execute()

	const stageConnectionsTemplate: Record<string, { to?: string[]; from?: string[] }> = {}
	for (const constraint of moveConstraints) {
		if (!stageConnectionsTemplate[constraint.sourceName]) {
			stageConnectionsTemplate[constraint.sourceName] = {}
		}
		if (!stageConnectionsTemplate[constraint.sourceName].to) {
			stageConnectionsTemplate[constraint.sourceName].to = []
		}
		stageConnectionsTemplate[constraint.sourceName].to!.push(constraint.destName)
	}

	// fetch forms
	const forms = await db
		.selectFrom("forms")
		.innerJoin("pub_types", "pub_types.id", "forms.pubTypeId")
		.select([
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
								.innerJoin("pub_types", "pub_types.id", "_FormElementToPubType.B")
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

	const formsTemplate: Record<string, TemplateForm> = {}
	for (const form of forms) {
		const elements: TemplateFormElement[] = form.elements.map((el) => {
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
			// button type - need to find the stage from config
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

		formsTemplate[form.name] = {
			pubType: form.pubTypeName,
			...(form.slug ? { slug: form.slug } : {}),
			...(form.access ? { access: form.access } : {}),
			...(form.isArchived ? { isArchived: form.isArchived } : {}),
			...(form.isDefault ? { isDefault: form.isDefault } : {}),
			elements,
		}
	}

	// build the template
	const template: CommunityTemplate = {
		community: {
			name: community.name,
			slug: community.slug,
			...(community.avatar ? { avatar: community.avatar } : {}),
		},
	}

	if (Object.keys(pubFieldsTemplate).length > 0) {
		template.pubFields = pubFieldsTemplate
	}

	if (Object.keys(pubTypesTemplate).length > 0) {
		template.pubTypes = pubTypesTemplate
	}

	if (Object.keys(stagesTemplate).length > 0) {
		template.stages = stagesTemplate
	}

	if (Object.keys(stageConnectionsTemplate).length > 0) {
		template.stageConnections = stageConnectionsTemplate
	}

	if (Object.keys(formsTemplate).length > 0) {
		template.forms = formsTemplate
	}

	// optionally export pubs
	if (includePubs) {
		const pubsTemplate = await exportPubs(communityId, pubTypes, stages)
		if (pubsTemplate.length > 0) {
			template.pubs = pubsTemplate
		}
	}

	// optionally export api tokens
	if (includeApiTokens) {
		const apiTokensTemplate = await exportApiTokens(communityId)
		if (Object.keys(apiTokensTemplate).length > 0) {
			template.apiTokens = apiTokensTemplate
		}
	}

	// optionally export action config defaults
	if (includeActionConfigDefaults) {
		const actionConfigDefaultsTemplate = await exportActionConfigDefaults(communityId)
		if (actionConfigDefaultsTemplate.length > 0) {
			template.actionConfigDefaults = actionConfigDefaultsTemplate
		}
	}

	return template
}

// helper to export pubs
const exportPubs = async (
	communityId: CommunitiesId,
	pubTypes: Array<{ id: string; name: string }>,
	stages: Array<{ id: string; name: string }>
): Promise<TemplatePub[]> => {
	// build lookup maps
	const pubTypeIdToName = new Map(pubTypes.map((pt) => [pt.id, pt.name]))
	const stageIdToName = new Map(stages.map((s) => [s.id, s.name]))

	// fetch all pubs with their values and stage info
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

	// build a map of pub id to pub for resolving related pubs
	const pubIdToIndex = new Map<string, number>()
	pubs.forEach((pub, idx) => {
		pubIdToIndex.set(pub.id, idx)
	})

	const result: TemplatePub[] = []
	for (const pub of pubs) {
		const pubTypeName = pubTypeIdToName.get(pub.pubTypeId)
		if (!pubTypeName) continue

		const stageId = pub.stages[0]?.stageId
		const stageName = stageId ? stageIdToName.get(stageId) : undefined

		// build values
		const values: Record<string, unknown> = {}
		for (const val of pub.values) {
			if (val.relatedPubId) {
				// relation value
				if (!values[val.fieldName]) {
					values[val.fieldName] = []
				}
				;(values[val.fieldName] as Array<{ value: unknown; relatedPubId: string }>).push({
					value: val.value,
					relatedPubId: val.relatedPubId,
				})
			} else {
				values[val.fieldName] = val.value
			}
		}

		result.push({
			id: pub.id,
			pubType: pubTypeName,
			values,
			...(stageName ? { stage: stageName } : {}),
		})
	}

	return result
}

// helper to export api tokens
const exportApiTokens = async (
	communityId: CommunitiesId
): Promise<Record<string, TemplateApiToken>> => {
	const tokens = await db
		.selectFrom("api_access_tokens")
		.select(["name", "description"])
		.select((eb) =>
			jsonArrayFrom(
				eb
					.selectFrom("api_access_permissions")
					.select(["scope", "accessType", "constraints"])
					.whereRef("api_access_permissions.apiAccessTokenId", "=", "api_access_tokens.id")
			).as("permissions")
		)
		.where("communityId", "=", communityId)
		.execute()

	const result: Record<string, TemplateApiToken> = {}
	for (const token of tokens) {
		// build permissions object
		const permissions: Record<string, unknown> = {}
		for (const perm of token.permissions) {
			if (!permissions[perm.scope]) {
				permissions[perm.scope] = {}
			}
			;(permissions[perm.scope] as Record<string, unknown>)[perm.accessType] = perm.constraints
		}

		result[token.name] = {
			...(token.description ? { description: token.description } : {}),
			permissions: Object.keys(permissions).length > 0 ? permissions : true,
		}
	}

	return result
}

// helper to export action config defaults
const exportActionConfigDefaults = async (
	communityId: CommunitiesId
): Promise<TemplateActionConfigDefault[]> => {
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
