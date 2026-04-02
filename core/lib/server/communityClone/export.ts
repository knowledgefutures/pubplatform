import type { CommunitiesId } from "db/public"

import type {
	CloneExportOptions,
	CommunityClone,
	CloneActionConfigDefault,
	CloneActionInstance,
	CloneApiAccessPermission,
	CloneApiAccessToken,
	CloneAutomation,
	CloneAutomationCondition,
	CloneAutomationConditionBlock,
	CloneAutomationTrigger,
	CloneForm,
	CloneFormElement,
	CloneFormElementToPubType,
	CloneMoveConstraint,
	ClonePub,
	ClonePubField,
	ClonePubFieldToPubType,
	ClonePubsInStages,
	ClonePubType,
	ClonePubValue,
	CloneStage,
} from "./types"

import { db } from "~/kysely/database"

export const exportCommunityClone = async (
	communityId: CommunitiesId,
	_options: CloneExportOptions = {}
): Promise<CommunityClone> => {
	// fetch community
	const community = await db
		.selectFrom("communities")
		.select(["id", "name", "slug", "avatar"])
		.where("id", "=", communityId)
		.executeTakeFirstOrThrow()

	// fetch pub fields
	const pubFields = await db
		.selectFrom("pub_fields")
		.select(["id", "name", "slug", "schemaName", "isRelation"])
		.where("communityId", "=", communityId)
		.execute()

	// fetch pub types
	const pubTypes = await db
		.selectFrom("pub_types")
		.select(["id", "name", "description"])
		.where("communityId", "=", communityId)
		.execute()

	// fetch pub field to pub type mappings
	const pubFieldToPubType = await db
		.selectFrom("_PubFieldToPubType")
		.innerJoin("pub_fields", "pub_fields.id", "_PubFieldToPubType.A")
		.select([
			"_PubFieldToPubType.A",
			"_PubFieldToPubType.B",
			"_PubFieldToPubType.isTitle",
			"_PubFieldToPubType.rank",
		])
		.where("pub_fields.communityId", "=", communityId)
		.execute()

	// fetch stages
	const stages = await db
		.selectFrom("stages")
		.select(["id", "name", "order"])
		.where("communityId", "=", communityId)
		.orderBy("order", "asc")
		.execute()

	const stageIds = stages.map((s) => s.id)

	// fetch move constraints (composite key, no id)
	const moveConstraints =
		stageIds.length > 0
			? await db
					.selectFrom("move_constraint")
					.select(["stageId", "destinationId"])
					.where("stageId", "in", stageIds)
					.execute()
			: []

	// fetch forms
	const forms = await db
		.selectFrom("forms")
		.select(["id", "name", "slug", "access", "isArchived", "isDefault", "pubTypeId"])
		.where("communityId", "=", communityId)
		.execute()

	const formIds = forms.map((f) => f.id)

	// fetch form elements
	const formElements =
		formIds.length > 0
			? await db
					.selectFrom("form_elements")
					.select([
						"id",
						"formId",
						"fieldId",
						"type",
						"component",
						"config",
						"content",
						"label",
						"element",
						"rank",
						"required",
						"stageId",
					])
					.where("formId", "in", formIds)
					.execute()
			: []

	const formElementIds = formElements.map((fe) => fe.id)

	// fetch form element to pub type mappings
	const formElementToPubType =
		formElementIds.length > 0
			? await db
					.selectFrom("_FormElementToPubType")
					.select(["A", "B"])
					.where("A", "in", formElementIds)
					.execute()
			: []

	// fetch automations
	const automations = await db
		.selectFrom("automations")
		.select(["id", "name", "stageId", "icon", "conditionEvaluationTiming", "resolver"])
		.where("communityId", "=", communityId)
		.execute()

	const automationIds = automations.map((a) => a.id)

	// fetch automation triggers
	const automationTriggers =
		automationIds.length > 0
			? await db
					.selectFrom("automation_triggers")
					.select(["id", "automationId", "event", "config", "sourceAutomationId"])
					.where("automationId", "in", automationIds)
					.execute()
			: []

	// fetch action instances
	const actionInstances =
		automationIds.length > 0
			? await db
					.selectFrom("action_instances")
					.select(["id", "automationId", "action", "config"])
					.where("automationId", "in", automationIds)
					.orderBy("createdAt", "asc")
					.execute()
			: []

	// fetch automation condition blocks
	const automationConditionBlocks =
		automationIds.length > 0
			? await db
					.selectFrom("automation_condition_blocks")
					.select(["id", "automationId", "automationConditionBlockId", "type", "rank"])
					.where("automationId", "in", automationIds)
					.execute()
			: []

	const conditionBlockIds = automationConditionBlocks.map((cb) => cb.id)

	// fetch automation conditions
	const automationConditions =
		conditionBlockIds.length > 0
			? await db
					.selectFrom("automation_conditions")
					.select(["id", "automationConditionBlockId", "type", "expression", "rank"])
					.where("automationConditionBlockId", "in", conditionBlockIds)
					.execute()
			: []

	// fetch pubs
	const pubs = await db
		.selectFrom("pubs")
		.select(["id", "pubTypeId"])
		.where("communityId", "=", communityId)
		.execute()

	const pubIds = pubs.map((p) => p.id)

	// fetch pub values
	const pubValues =
		pubIds.length > 0
			? await db
					.selectFrom("pub_values")
					.select(["id", "pubId", "fieldId", "value", "relatedPubId"])
					.where("pubId", "in", pubIds)
					.execute()
			: []

	// fetch pubs in stages
	const pubsInStages =
		pubIds.length > 0
			? await db
					.selectFrom("PubsInStages")
					.select(["pubId", "stageId"])
					.where("pubId", "in", pubIds)
					.execute()
			: []

	// fetch api access tokens
	const apiAccessTokens = await db
		.selectFrom("api_access_tokens")
		.select(["id", "name", "description", "expiration"])
		.where("communityId", "=", communityId)
		.execute()

	const tokenIds = apiAccessTokens.map((t) => t.id)

	// fetch api access permissions
	const apiAccessPermissions =
		tokenIds.length > 0
			? await db
					.selectFrom("api_access_permissions")
					.select(["id", "apiAccessTokenId", "scope", "accessType", "constraints"])
					.where("apiAccessTokenId", "in", tokenIds)
					.execute()
			: []

	// fetch action config defaults
	const actionConfigDefaults = await db
		.selectFrom("action_config_defaults")
		.select(["action", "config"])
		.where("communityId", "=", communityId)
		.execute()

	return {
		version: "1.0",
		exportedAt: new Date().toISOString(),
		sourceCommunity: {
			id: community.id,
			name: community.name,
			slug: community.slug,
		},
		data: {
			community: {
				name: community.name,
				slug: community.slug,
				avatar: community.avatar,
			},
			pubFields: pubFields as ClonePubField[],
			pubTypes: pubTypes as ClonePubType[],
			pubFieldToPubType: pubFieldToPubType as ClonePubFieldToPubType[],
			stages: stages as CloneStage[],
			moveConstraints: moveConstraints as CloneMoveConstraint[],
			forms: forms as CloneForm[],
			formElements: formElements as CloneFormElement[],
			formElementToPubType: formElementToPubType as CloneFormElementToPubType[],
			automations: automations as CloneAutomation[],
			automationTriggers: automationTriggers as CloneAutomationTrigger[],
			actionInstances: actionInstances as CloneActionInstance[],
			automationConditionBlocks: automationConditionBlocks as CloneAutomationConditionBlock[],
			automationConditions: automationConditions as CloneAutomationCondition[],
			pubs: pubs as ClonePub[],
			pubValues: pubValues as ClonePubValue[],
			pubsInStages: pubsInStages as ClonePubsInStages[],
			apiAccessTokens: apiAccessTokens as CloneApiAccessToken[],
			apiAccessPermissions: apiAccessPermissions as CloneApiAccessPermission[],
			actionConfigDefaults: actionConfigDefaults as CloneActionConfigDefault[],
		},
	}
}
