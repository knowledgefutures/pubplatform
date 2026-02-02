import type {
	Action,
	ActionInstancesId,
	ApiAccessPermissionsId,
	ApiAccessScope,
	ApiAccessTokensId,
	ApiAccessType,
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
} from "db/public"

// id mapping structure for remapping entity ids during clone import
export type IdMapping = {
	communities: Map<CommunitiesId, CommunitiesId>
	pubFields: Map<PubFieldsId, PubFieldsId>
	pubTypes: Map<PubTypesId, PubTypesId>
	stages: Map<StagesId, StagesId>
	pubs: Map<PubsId, PubsId>
	pubValues: Map<PubValuesId, PubValuesId>
	forms: Map<FormsId, FormsId>
	formElements: Map<FormElementsId, FormElementsId>
	// move constraints use composite key, not id
	automations: Map<AutomationsId, AutomationsId>
	automationTriggers: Map<AutomationTriggersId, AutomationTriggersId>
	actionInstances: Map<ActionInstancesId, ActionInstancesId>
	automationConditionBlocks: Map<AutomationConditionBlocksId, AutomationConditionBlocksId>
	automationConditions: Map<AutomationConditionsId, AutomationConditionsId>
	apiAccessTokens: Map<ApiAccessTokensId, ApiAccessTokensId>
	apiAccessPermissions: Map<ApiAccessPermissionsId, ApiAccessPermissionsId>
}

// helper to create an empty id mapping
export const createEmptyIdMapping = (): IdMapping => ({
	communities: new Map(),
	pubFields: new Map(),
	pubTypes: new Map(),
	stages: new Map(),
	pubs: new Map(),
	pubValues: new Map(),
	forms: new Map(),
	formElements: new Map(),
	automations: new Map(),
	automationTriggers: new Map(),
	actionInstances: new Map(),
	automationConditionBlocks: new Map(),
	automationConditions: new Map(),
	apiAccessTokens: new Map(),
	apiAccessPermissions: new Map(),
})

// pub field data for clone
export type ClonePubField = {
	id: PubFieldsId
	name: string
	slug: string
	schemaName: string
	isRelation: boolean | null
}

// pub type data for clone
export type ClonePubType = {
	id: PubTypesId
	name: string
	description: string | null
}

// pub field to pub type mapping
export type ClonePubFieldToPubType = {
	A: PubFieldsId
	B: PubTypesId
	isTitle: boolean
	rank: string
}

// stage data for clone
export type CloneStage = {
	id: StagesId
	name: string
	order: string
}

// move constraint data for clone (composite key)
export type CloneMoveConstraint = {
	stageId: StagesId
	destinationId: StagesId
}

// form data for clone
export type CloneForm = {
	id: FormsId
	name: string
	slug: string
	access: string | null
	isArchived: boolean
	isDefault: boolean
	pubTypeId: PubTypesId
}

// form element data for clone
export type CloneFormElement = {
	id: FormElementsId
	formId: FormsId
	fieldId: PubFieldsId | null
	type: string
	component: string | null
	config: unknown
	content: string | null
	label: string | null
	element: string | null
	rank: string
	required: boolean | null
	stageId: StagesId | null
}

// form element to pub type mapping
export type CloneFormElementToPubType = {
	A: FormElementsId
	B: PubTypesId
}

// automation data for clone
export type CloneAutomation = {
	id: AutomationsId
	name: string
	stageId: StagesId | null
	icon: unknown
	conditionEvaluationTiming: string | null
	resolver: string | null
}

// automation trigger data for clone
export type CloneAutomationTrigger = {
	id: AutomationTriggersId
	automationId: AutomationsId
	event: string
	config: unknown
	sourceAutomationId: AutomationsId | null
}

// action instance data for clone
export type CloneActionInstance = {
	id: ActionInstancesId
	automationId: AutomationsId
	action: Action
	config: unknown
}

// automation condition block data for clone
export type CloneAutomationConditionBlock = {
	id: AutomationConditionBlocksId
	automationId: AutomationsId | null
	automationConditionBlockId: AutomationConditionBlocksId | null
	type: string
	rank: string
}

// automation condition data for clone
export type CloneAutomationCondition = {
	id: AutomationConditionsId
	automationConditionBlockId: AutomationConditionBlocksId
	type: string
	expression: string | null
	rank: string
}

// pub data for clone (no parentId, relationships are through pub_values)
export type ClonePub = {
	id: PubsId
	pubTypeId: PubTypesId
}

// pub value data for clone
export type ClonePubValue = {
	id: PubValuesId
	pubId: PubsId
	fieldId: PubFieldsId
	value: unknown
	relatedPubId: PubsId | null
}

// pubs in stages data for clone
export type ClonePubsInStages = {
	pubId: PubsId
	stageId: StagesId
}

// api access token data for clone
export type CloneApiAccessToken = {
	id: ApiAccessTokensId
	name: string
	description: string | null
	expiration: Date | null
}

// api access permission data for clone
export type CloneApiAccessPermission = {
	id: ApiAccessPermissionsId
	apiAccessTokenId: ApiAccessTokensId
	scope: ApiAccessScope
	accessType: ApiAccessType
	constraints: unknown
}

// action config default data for clone
export type CloneActionConfigDefault = {
	action: Action
	config: unknown
}

// export options for community clone
export type CloneExportOptions = {
	// automation logs are not exported due to complexity
}

// the main community clone format
export type CommunityClone = {
	version: "1.0"
	exportedAt: string
	sourceCommunity: {
		id: CommunitiesId
		name: string
		slug: string
	}

	data: {
		// community info
		community: {
			name: string
			slug: string
			avatar: string | null
		}

		// schema
		pubFields: ClonePubField[]
		pubTypes: ClonePubType[]
		pubFieldToPubType: ClonePubFieldToPubType[]

		// stages
		stages: CloneStage[]
		moveConstraints: CloneMoveConstraint[]

		// forms
		forms: CloneForm[]
		formElements: CloneFormElement[]
		formElementToPubType: CloneFormElementToPubType[]

		// automations
		automations: CloneAutomation[]
		automationTriggers: CloneAutomationTrigger[]
		actionInstances: CloneActionInstance[]
		automationConditionBlocks: CloneAutomationConditionBlock[]
		automationConditions: CloneAutomationCondition[]

		// pubs
		pubs: ClonePub[]
		pubValues: ClonePubValue[]
		pubsInStages: ClonePubsInStages[]

		// config
		apiAccessTokens: CloneApiAccessToken[]
		apiAccessPermissions: CloneApiAccessPermission[]
		actionConfigDefaults: CloneActionConfigDefault[]
	}
}
