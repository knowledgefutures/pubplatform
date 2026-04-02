import type {
	ActionInstancesId,
	ApiAccessPermissionsId,
	ApiAccessTokensId,
	AutomationConditionBlocksId,
	AutomationConditionsId,
	AutomationsId,
	AutomationTriggersId,
	CommunitiesId,
	FormElementsId,
	FormsId,
	PubFieldsId,
	PubsId,
	PubTypesId,
	PubValuesId,
	StagesId,
	UsersId,
} from "db/public"

import type { CommunityClone, IdMapping } from "./types"
import { createEmptyIdMapping } from "./types"

import { db } from "~/kysely/database"
import { createLastModifiedBy } from "~/lib/lastModifiedBy"
import { generateToken } from "~/lib/server/token"

export type CloneImportOptions = {
	// new slug for the community (required to avoid conflict)
	newSlug: string
	// optional new name
	newName?: string
	// user id to use for api token issuedById
	issuedById: UsersId
}

export const importCommunityClone = async (
	clone: CommunityClone,
	options: CloneImportOptions,
	trx = db
): Promise<{ communityId: CommunitiesId; mapping: IdMapping }> => {
	const mapping = createEmptyIdMapping()
	const { data } = clone
	const { newSlug, newName, issuedById } = options

	// generate new community id
	const newCommunityId = crypto.randomUUID() as CommunitiesId
	mapping.communities.set(clone.sourceCommunity.id, newCommunityId)

	// create community
	await trx
		.insertInto("communities")
		.values({
			id: newCommunityId,
			name: newName ?? data.community.name,
			slug: newSlug,
			avatar: data.community.avatar,
		})
		.execute()

	// create pub fields with new ids
	for (const field of data.pubFields) {
		const newId = crypto.randomUUID() as PubFieldsId
		mapping.pubFields.set(field.id, newId)

		// update slug to use new community slug
		const slugParts = field.slug.split(":")
		const fieldSlug = slugParts.length > 1 ? slugParts[1] : field.slug
		const newFieldSlug = `${newSlug}:${fieldSlug}`

		await trx
			.insertInto("pub_fields")
			.values({
				id: newId,
				name: field.name,
				slug: newFieldSlug,
				communityId: newCommunityId,
				schemaName: field.schemaName as any,
				isRelation: field.isRelation ?? false,
			})
			.execute()
	}

	// create pub types with new ids
	for (const pubType of data.pubTypes) {
		const newId = crypto.randomUUID() as PubTypesId
		mapping.pubTypes.set(pubType.id, newId)

		await trx
			.insertInto("pub_types")
			.values({
				id: newId,
				name: pubType.name,
				description: pubType.description,
				communityId: newCommunityId,
			})
			.execute()
	}

	// create pub field to pub type mappings
	for (const mappingEntry of data.pubFieldToPubType) {
		const newFieldId = mapping.pubFields.get(mappingEntry.A)
		const newPubTypeId = mapping.pubTypes.get(mappingEntry.B)

		if (!newFieldId || !newPubTypeId) continue

		await trx
			.insertInto("_PubFieldToPubType")
			.values({
				A: newFieldId,
				B: newPubTypeId,
				isTitle: mappingEntry.isTitle,
				rank: mappingEntry.rank,
			})
			.execute()
	}

	// create stages with new ids
	for (const stage of data.stages) {
		const newId = crypto.randomUUID() as StagesId
		mapping.stages.set(stage.id, newId)

		await trx
			.insertInto("stages")
			.values({
				id: newId,
				name: stage.name,
				order: stage.order,
				communityId: newCommunityId,
			})
			.execute()
	}

	// create move constraints (composite key, no id)
	for (const constraint of data.moveConstraints) {
		const newStageId = mapping.stages.get(constraint.stageId)
		const newDestId = mapping.stages.get(constraint.destinationId)

		if (!newStageId || !newDestId) continue

		await trx
			.insertInto("move_constraint")
			.values({
				stageId: newStageId,
				destinationId: newDestId,
			})
			.execute()
	}

	// create forms with new ids
	for (const form of data.forms) {
		const newId = crypto.randomUUID() as FormsId
		const newPubTypeId = mapping.pubTypes.get(form.pubTypeId)

		if (!newPubTypeId) continue

		mapping.forms.set(form.id, newId)

		await trx
			.insertInto("forms")
			.values({
				id: newId,
				name: form.name,
				slug: form.slug,
				access: form.access as any,
				isArchived: form.isArchived,
				isDefault: form.isDefault,
				pubTypeId: newPubTypeId,
				communityId: newCommunityId,
			})
			.execute()
	}

	// create form elements with new ids
	for (const element of data.formElements) {
		const newId = crypto.randomUUID() as FormElementsId
		const newFormId = mapping.forms.get(element.formId)
		const newFieldId = element.fieldId ? mapping.pubFields.get(element.fieldId) : null
		const newStageId = element.stageId ? mapping.stages.get(element.stageId) : null

		if (!newFormId) continue

		mapping.formElements.set(element.id, newId)

		await trx
			.insertInto("form_elements")
			.values({
				id: newId,
				formId: newFormId,
				fieldId: newFieldId,
				type: element.type as any,
				component: element.component as any,
				config: element.config as any,
				content: element.content,
				label: element.label,
				element: element.element as any,
				rank: element.rank,
				required: element.required,
				stageId: newStageId,
			})
			.execute()
	}

	// create form element to pub type mappings
	for (const mappingEntry of data.formElementToPubType) {
		const newElementId = mapping.formElements.get(mappingEntry.A)
		const newPubTypeId = mapping.pubTypes.get(mappingEntry.B)

		if (!newElementId || !newPubTypeId) continue

		await trx
			.insertInto("_FormElementToPubType")
			.values({
				A: newElementId,
				B: newPubTypeId,
			})
			.execute()
	}

	// create automations with new ids
	for (const automation of data.automations) {
		const newId = crypto.randomUUID() as AutomationsId
		const newStageId = automation.stageId ? mapping.stages.get(automation.stageId) : null

		mapping.automations.set(automation.id, newId)

		await trx
			.insertInto("automations")
			.values({
				id: newId,
				name: automation.name,
				stageId: newStageId,
				icon: automation.icon as any,
				conditionEvaluationTiming: automation.conditionEvaluationTiming as any,
				resolver: automation.resolver,
				communityId: newCommunityId,
			})
			.execute()
	}

	// create automation triggers with new ids
	for (const trigger of data.automationTriggers) {
		const newId = crypto.randomUUID() as AutomationTriggersId
		const newAutomationId = mapping.automations.get(trigger.automationId)
		const newSourceAutomationId = trigger.sourceAutomationId
			? mapping.automations.get(trigger.sourceAutomationId)
			: null

		if (!newAutomationId) continue

		mapping.automationTriggers.set(trigger.id, newId)

		await trx
			.insertInto("automation_triggers")
			.values({
				id: newId,
				automationId: newAutomationId,
				event: trigger.event as any,
				config: trigger.config as any,
				sourceAutomationId: newSourceAutomationId,
			})
			.execute()
	}

	// create action instances with new ids
	for (const action of data.actionInstances) {
		const newId = crypto.randomUUID() as ActionInstancesId
		const newAutomationId = mapping.automations.get(action.automationId)

		if (!newAutomationId) continue

		mapping.actionInstances.set(action.id, newId)

		await trx
			.insertInto("action_instances")
			.values({
				id: newId,
				automationId: newAutomationId,
				action: action.action,
				config: action.config as any,
			})
			.execute()
	}

	// create automation condition blocks with new ids
	// first pass: create all blocks without parent references
	for (const block of data.automationConditionBlocks) {
		const newId = crypto.randomUUID() as AutomationConditionBlocksId
		const newAutomationId = block.automationId
			? mapping.automations.get(block.automationId)
			: null

		mapping.automationConditionBlocks.set(block.id, newId)

		await trx
			.insertInto("automation_condition_blocks")
			.values({
				id: newId,
				automationId: newAutomationId as any,
				automationConditionBlockId: null,
				type: block.type as any,
				rank: block.rank,
			})
			.execute()
	}

	// second pass: update parent references
	for (const block of data.automationConditionBlocks) {
		if (!block.automationConditionBlockId) continue

		const newId = mapping.automationConditionBlocks.get(block.id)
		const newParentId = mapping.automationConditionBlocks.get(block.automationConditionBlockId)

		if (!newId || !newParentId) continue

		await trx
			.updateTable("automation_condition_blocks")
			.set({ automationConditionBlockId: newParentId })
			.where("id", "=", newId)
			.execute()
	}

	// create automation conditions with new ids
	for (const condition of data.automationConditions) {
		const newId = crypto.randomUUID() as AutomationConditionsId
		const newBlockId = mapping.automationConditionBlocks.get(condition.automationConditionBlockId)

		if (!newBlockId) continue

		mapping.automationConditions.set(condition.id, newId)

		await trx
			.insertInto("automation_conditions")
			.values({
				id: newId,
				automationConditionBlockId: newBlockId,
				type: condition.type as any,
				expression: condition.expression ?? "",
				rank: condition.rank,
			})
			.execute()
	}

	// create pubs with new ids
	for (const pub of data.pubs) {
		const newId = crypto.randomUUID() as PubsId
		const newPubTypeId = mapping.pubTypes.get(pub.pubTypeId)

		if (!newPubTypeId) continue

		mapping.pubs.set(pub.id, newId)

		await trx
			.insertInto("pubs")
			.values({
				id: newId,
				pubTypeId: newPubTypeId,
				communityId: newCommunityId,
			})
			.execute()
	}

	// create pub values with new ids
	const lastModifiedBy = createLastModifiedBy("system")
	for (const value of data.pubValues) {
		const newId = crypto.randomUUID() as PubValuesId
		const newPubId = mapping.pubs.get(value.pubId)
		const newFieldId = mapping.pubFields.get(value.fieldId)
		const newRelatedPubId = value.relatedPubId
			? mapping.pubs.get(value.relatedPubId) ?? null
			: null

		if (!newPubId || !newFieldId) continue

		mapping.pubValues.set(value.id, newId)

		await trx
			.insertInto("pub_values")
			.values({
				id: newId,
				pubId: newPubId,
				fieldId: newFieldId,
				value: value.value as any,
				relatedPubId: newRelatedPubId as any,
				lastModifiedBy,
			})
			.execute()
	}

	// create pubs in stages
	for (const pubInStage of data.pubsInStages) {
		const newPubId = mapping.pubs.get(pubInStage.pubId)
		const newStageId = mapping.stages.get(pubInStage.stageId)

		if (!newPubId || !newStageId) continue

		await trx
			.insertInto("PubsInStages")
			.values({
				pubId: newPubId,
				stageId: newStageId,
			})
			.execute()
	}

	// create api access tokens with new ids
	for (const token of data.apiAccessTokens) {
		const newId = crypto.randomUUID() as ApiAccessTokensId
		mapping.apiAccessTokens.set(token.id, newId)

		// generate new token value
		const newTokenValue = generateToken()

		// handle expiration date (may be string after JSON parsing)
		const expiration = token.expiration
			? new Date(token.expiration)
			: null

		await trx
			.insertInto("api_access_tokens")
			.values({
				id: newId,
				name: token.name,
				token: newTokenValue,
				description: token.description,
				expiration: expiration as any,
				issuedAt: new Date(),
				issuedById: issuedById,
				communityId: newCommunityId,
			})
			.execute()
	}

	// create api access permissions with new ids
	for (const permission of data.apiAccessPermissions) {
		const newId = crypto.randomUUID() as ApiAccessPermissionsId
		const newTokenId = mapping.apiAccessTokens.get(permission.apiAccessTokenId)

		if (!newTokenId) continue

		mapping.apiAccessPermissions.set(permission.id, newId)

		await trx
			.insertInto("api_access_permissions")
			.values({
				id: newId,
				apiAccessTokenId: newTokenId,
				scope: permission.scope,
				accessType: permission.accessType,
				constraints: permission.constraints as any,
			})
			.execute()
	}

	// create action config defaults
	for (const configDefault of data.actionConfigDefaults) {
		await trx
			.insertInto("action_config_defaults")
			.values({
				action: configDefault.action,
				config: configDefault.config as any,
				communityId: newCommunityId,
			})
			.execute()
	}

	return { communityId: newCommunityId, mapping }
}
