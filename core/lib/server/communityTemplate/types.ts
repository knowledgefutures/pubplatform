import type {
	Action,
	AutomationConditionBlockType,
	AutomationEvent,
	ConditionEvaluationTiming,
	CoreSchemaType,
	ElementType,
	FormAccessType,
	InputComponent,
	MemberRole,
	StructuralFormElement,
} from "db/public"
import type { IconConfig } from "ui/dynamic-icon"

// condition items for automations
export type TemplateConditionItem =
	| {
			kind: "condition"
			type: "jsonata"
			expression: string
	  }
	| {
			kind: "block"
			type: AutomationConditionBlockType
			items: TemplateConditionItem[]
	  }

// automation trigger configuration
export type TemplateAutomationTrigger = {
	event: AutomationEvent
	config: Record<string, unknown>
	sourceAutomation?: string
}

// automation action configuration
export type TemplateAutomationAction = {
	action: Action
	name?: string
	config: Record<string, unknown>
}

// single automation definition
export type TemplateAutomation = {
	icon?: IconConfig
	sourceAutomation?: string
	timing?: ConditionEvaluationTiming
	condition?: {
		type: AutomationConditionBlockType
		items: TemplateConditionItem[]
	}
	resolver?: string
	triggers: TemplateAutomationTrigger[]
	actions: TemplateAutomationAction[]
}

// pub field definition
export type TemplatePubField = {
	schemaName: CoreSchemaType
	relation?: true
}

// pub type field mapping
export type TemplatePubTypeField = {
	isTitle: boolean
}

// stage definition
export type TemplateStage = {
	members?: Record<string, MemberRole>
	automations?: Record<string, TemplateAutomation>
}

// stage connections
export type TemplateStageConnections = Record<
	string,
	{
		to?: string[]
		from?: string[]
	}
>

// user definition (passwords will be handled separately for security)
export type TemplateUser = {
	email?: string
	firstName?: string
	lastName?: string
	avatar?: string
	role?: MemberRole | null
	isSuperAdmin?: boolean
}

// form element - pub field type
export type TemplateFormElementPubField = {
	type: typeof ElementType.pubfield
	field: string
	component: InputComponent | null
	config: Record<string, unknown>
	relatedPubTypes?: string[]
}

// form element - structural type
export type TemplateFormElementStructural = {
	type: typeof ElementType.structural
	element: StructuralFormElement
	content: string
}

// form element - button type
export type TemplateFormElementButton = {
	type: typeof ElementType.button
	label: string
	content: string
	stage: string
}

export type TemplateFormElement =
	| TemplateFormElementPubField
	| TemplateFormElementStructural
	| TemplateFormElementButton

// form definition
export type TemplateForm = {
	access?: FormAccessType
	isArchived?: boolean
	slug?: string
	pubType: string
	members?: string[]
	isDefault?: boolean
	elements: TemplateFormElement[]
}

// pub value - can be a simple value or a relation reference
export type TemplatePubValue = unknown | Array<{ value: unknown; relatedPubId: string }>

// related pub inline definition
export type TemplateRelatedPub = {
	value?: unknown
	pub: TemplatePub
}

// pub definition
export type TemplatePub = {
	id?: string
	pubType: string
	values: Record<string, TemplatePubValue>
	stage?: string
	members?: Record<string, MemberRole>
	relatedPubs?: Record<string, TemplateRelatedPub[]>
}

// api token definition
export type TemplateApiToken = {
	description?: string
	permissions?: Record<string, unknown> | true
}

// action config default definition
export type TemplateActionConfigDefault = {
	action: Action
	config: Record<string, unknown>
}

// the main community template type
export type CommunityTemplate = {
	community: {
		name: string
		slug: string
		avatar?: string
	}
	pubFields?: Record<string, TemplatePubField>
	pubTypes?: Record<string, Record<string, TemplatePubTypeField>>
	// users are optional - if not provided, memberships are skipped
	users?: Record<string, TemplateUser>
	stages?: Record<string, TemplateStage>
	stageConnections?: TemplateStageConnections
	pubs?: TemplatePub[]
	forms?: Record<string, TemplateForm>
	apiTokens?: Record<string, TemplateApiToken>
	actionConfigDefaults?: TemplateActionConfigDefault[]
}

// options for exporting a community template
export type TemplateExportOptions = {
	includePubs?: boolean
	includeApiTokens?: boolean
	includeActionConfigDefaults?: boolean
}

// minimal template for starting from scratch
export const MINIMAL_TEMPLATE: CommunityTemplate = {
	community: {
		name: "New Community",
		slug: "new-community",
	},
}

// example template with common structure (no users - memberships skipped)
export const EXAMPLE_TEMPLATE: CommunityTemplate = {
	community: {
		name: "Example Community",
		slug: "example-community",
	},
	pubFields: {
		Title: { schemaName: "String" as CoreSchemaType },
		Content: { schemaName: "RichText" as CoreSchemaType },
	},
	pubTypes: {
		Article: {
			Title: { isTitle: true },
			Content: { isTitle: false },
		},
	},
	stages: {
		Draft: {},
		Published: {},
	},
	stageConnections: {
		Draft: {
			to: ["Published"],
		},
	},
}
