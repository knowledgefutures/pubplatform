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

export const BLUEPRINT_VERSION = "1" as const

// ============================================================================
// condition / automation primitives
// ============================================================================

export type BlueprintConditionItem =
	| { kind: "condition"; type: "jsonata"; expression: string }
	| { kind: "block"; type: AutomationConditionBlockType; items: BlueprintConditionItem[] }

export type BlueprintAutomationTrigger = {
	event: AutomationEvent
	config: Record<string, unknown>
	sourceAutomation?: string
}

export type BlueprintAutomationAction = {
	action: Action
	name?: string
	config: Record<string, unknown>
}

export type BlueprintAutomation = {
	icon?: IconConfig
	sourceAutomation?: string
	timing?: ConditionEvaluationTiming
	condition?: {
		type: AutomationConditionBlockType
		items: BlueprintConditionItem[]
	}
	resolver?: string
	triggers: BlueprintAutomationTrigger[]
	actions: BlueprintAutomationAction[]
}

// ============================================================================
// pub fields / pub types
// ============================================================================

export type BlueprintPubField = {
	schemaName: CoreSchemaType
	relation?: true
}

export type BlueprintPubTypeField = {
	isTitle: boolean
}

// ============================================================================
// stages
// ============================================================================

export type BlueprintStage = {
	members?: Record<string, MemberRole>
	automations?: Record<string, BlueprintAutomation>
}

export type BlueprintStageConnections = Record<
	string,
	{ to?: string[]; from?: string[] }
>

// ============================================================================
// user slots
//
// users are not stored in blueprints. instead, we record "slots" that describe
// where a user reference existed. during import the user decides how to fill
// each slot (map to existing user, create new, or skip).
// ============================================================================

export type BlueprintUserSlot = {
	role?: MemberRole | null
	description?: string
}

// ============================================================================
// forms
// ============================================================================

export type BlueprintFormElementPubField = {
	type: typeof ElementType.pubfield
	field: string
	component: InputComponent | null
	config: Record<string, unknown>
	relatedPubTypes?: string[]
}

export type BlueprintFormElementStructural = {
	type: typeof ElementType.structural
	element: StructuralFormElement
	content: string
}

export type BlueprintFormElementButton = {
	type: typeof ElementType.button
	label: string
	content: string
	stage: string
}

export type BlueprintFormElement =
	| BlueprintFormElementPubField
	| BlueprintFormElementStructural
	| BlueprintFormElementButton

export type BlueprintForm = {
	access?: FormAccessType
	isArchived?: boolean
	slug?: string
	pubType: string
	members?: string[]
	isDefault?: boolean
	elements: BlueprintFormElement[]
}

// ============================================================================
// pubs
//
// pubs are keyed by a stable symbolic name so that relations between pubs can
// be expressed as references to those keys instead of UUIDs.
// ============================================================================

export type BlueprintRelatedPub = {
	value?: unknown
	// either an inline pub definition or a reference to another pub key
	pub?: BlueprintPub
	ref?: string
}

export type BlueprintPub = {
	pubType: string
	values: Record<string, unknown>
	stage?: string
	members?: Record<string, MemberRole>
	relatedPubs?: Record<string, BlueprintRelatedPub[]>
}

// ============================================================================
// api tokens
// ============================================================================

export type BlueprintApiToken = {
	description?: string
	permissions?: Record<string, unknown> | true
}

// ============================================================================
// action config defaults
// ============================================================================

export type BlueprintActionConfigDefault = {
	action: Action
	config: Record<string, unknown>
}

// ============================================================================
// top-level blueprint
// ============================================================================

export type Blueprint = {
	version: typeof BLUEPRINT_VERSION
	community: {
		name: string
		slug: string
		avatar?: string
	}
	pubFields?: Record<string, BlueprintPubField>
	pubTypes?: Record<string, Record<string, BlueprintPubTypeField>>
	stages?: Record<string, BlueprintStage>
	stageConnections?: BlueprintStageConnections
	forms?: Record<string, BlueprintForm>
	pubs?: Record<string, BlueprintPub>
	apiTokens?: Record<string, BlueprintApiToken>
	actionConfigDefaults?: BlueprintActionConfigDefault[]
	userSlots?: Record<string, BlueprintUserSlot>
}

// ============================================================================
// export options
// ============================================================================

export type BlueprintExportOptions = {
	includePubs?: boolean
	includeApiTokens?: boolean
	includeActionConfigDefaults?: boolean
}

// ============================================================================
// import options
// ============================================================================

export type BlueprintImportOptions = {
	userMapping?: Record<string, string | "skip">
	overrides?: {
		slug?: string
		name?: string
	}
}

// ============================================================================
// warning produced during export or import
// ============================================================================

export type BlueprintWarning = {
	path: string
	message: string
}
