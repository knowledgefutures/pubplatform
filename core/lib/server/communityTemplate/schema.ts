// json schema for community templates
// this schema is used by monaco editor for validation

export type JSONSchema = {
	$schema?: string
	$ref?: string
	$defs?: Record<string, JSONSchema>
	title?: string
	description?: string
	type?: string | string[]
	properties?: Record<string, JSONSchema>
	additionalProperties?: boolean | JSONSchema
	items?: JSONSchema | JSONSchema[]
	required?: string[]
	enum?: (string | number | boolean | null)[]
	const?: unknown
	allOf?: JSONSchema[]
	oneOf?: JSONSchema[]
	anyOf?: JSONSchema[]
	not?: JSONSchema
	if?: JSONSchema
	then?: JSONSchema
	else?: JSONSchema
	minItems?: number
	maxItems?: number
	minLength?: number
	maxLength?: number
	pattern?: string
	minimum?: number
	maximum?: number
	default?: unknown
	format?: string
}

const coreSchemaTypes = [
	"String",
	"Boolean",
	"Vector3",
	"DateTime",
	"Email",
	"URL",
	"MemberId",
	"FileUpload",
	"Null",
	"Number",
	"NumericArray",
	"StringArray",
	"RichText",
	"Color",
] as const

const memberRoles = ["admin", "editor", "contributor"] as const

const automationEvents = [
	"pubEnteredStage",
	"pubLeftStage",
	"pubInStageForDuration",
	"automationSucceeded",
	"automationFailed",
	"webhook",
	"manual",
] as const

const actions = [
	"log",
	"email",
	"http",
	"move",
	"googleDriveImport",
	"datacite",
	"buildJournalSite",
	"createPub",
	"buildSite",
] as const

const elementTypes = ["pubfield", "structural", "button"] as const

const inputComponents = [
	"textArea",
	"textInput",
	"datePicker",
	"checkbox",
	"fileUpload",
	"memberSelect",
	"confidenceInterval",
	"checkboxGroup",
	"radioGroup",
	"selectDropdown",
	"multivalueInput",
	"richText",
	"relationBlock",
	"colorPicker",
] as const

const structuralFormElements = ["h2", "h3", "p", "hr"] as const

const formAccessTypes = ["private", "public"] as const

const conditionBlockTypes = ["AND", "OR", "NOT"] as const

const conditionEvaluationTimings = ["onTrigger", "onExecution", "both"] as const

export const createCommunityTemplateSchema = (): JSONSchema => {
	const conditionItemRef: JSONSchema = {
		$ref: "#/$defs/conditionItem",
	}

	const conditionItem: JSONSchema = {
		oneOf: [
			{
				type: "object",
				properties: {
					kind: { const: "condition" },
					type: { const: "jsonata" },
					expression: {
						type: "string",
						description: "JSONata expression to evaluate",
					},
				},
				required: ["kind", "type", "expression"],
				additionalProperties: false,
			},
			{
				type: "object",
				properties: {
					kind: { const: "block" },
					type: {
						enum: [...conditionBlockTypes],
						description: "Logical operator for combining conditions",
					},
					items: {
						type: "array",
						items: conditionItemRef,
						description: "Nested conditions",
					},
				},
				required: ["kind", "type", "items"],
				additionalProperties: false,
			},
		],
	}

	const automationTrigger: JSONSchema = {
		type: "object",
		properties: {
			event: {
				enum: [...automationEvents],
				description: "The event that triggers this automation",
			},
			config: {
				type: "object",
				description: "Event-specific configuration",
				additionalProperties: true,
			},
			sourceAutomation: {
				type: "string",
				description: "Name of source automation for chained triggers",
			},
		},
		required: ["event", "config"],
		additionalProperties: false,
	}

	const automationAction: JSONSchema = {
		type: "object",
		properties: {
			action: {
				enum: [...actions],
				description: "The action to execute",
			},
			name: {
				type: "string",
				description: "Display name for the action",
			},
			config: {
				type: "object",
				description: "Action-specific configuration",
				additionalProperties: true,
			},
		},
		required: ["action", "config"],
		additionalProperties: false,
	}

	const iconConfig: JSONSchema = {
		type: "object",
		properties: {
			name: { type: "string", description: "Icon name from lucide-react" },
			color: { type: "string", description: "Icon color (hex or named)" },
		},
		required: ["name"],
		additionalProperties: false,
	}

	const automation: JSONSchema = {
		type: "object",
		properties: {
			icon: iconConfig,
			sourceAutomation: {
				type: "string",
				description: "Reference to another automation",
			},
			timing: {
				enum: [...conditionEvaluationTimings],
				description: "When to evaluate conditions",
			},
			condition: {
				type: "object",
				properties: {
					type: {
						enum: [...conditionBlockTypes],
						description: "Root condition block type",
					},
					items: {
						type: "array",
						items: conditionItemRef,
					},
				},
				required: ["type", "items"],
				additionalProperties: false,
			},
			resolver: {
				type: "string",
				description: "JSONata expression to resolve a different pub",
			},
			triggers: {
				type: "array",
				items: automationTrigger,
				minItems: 1,
				description: "Events that trigger this automation",
			},
			actions: {
				type: "array",
				items: automationAction,
				minItems: 1,
				description: "Actions to execute when triggered",
			},
		},
		required: ["triggers", "actions"],
		additionalProperties: false,
	}

	const pubField: JSONSchema = {
		type: "object",
		properties: {
			schemaName: {
				enum: [...coreSchemaTypes],
				description: "The schema type for this field",
			},
			relation: {
				type: "boolean",
				description: "Whether this field is a relation to other pubs",
			},
		},
		required: ["schemaName"],
		additionalProperties: false,
	}

	const pubTypeField: JSONSchema = {
		type: "object",
		properties: {
			isTitle: {
				type: "boolean",
				description: "Whether this field is used as the pub title",
			},
		},
		required: ["isTitle"],
		additionalProperties: false,
	}

	const stage: JSONSchema = {
		type: "object",
		properties: {
			members: {
				type: "object",
				additionalProperties: {
					enum: [...memberRoles],
				},
				description: "User slugs mapped to their roles in this stage",
			},
			automations: {
				type: "object",
				additionalProperties: automation,
				description: "Automations attached to this stage",
			},
		},
		additionalProperties: false,
	}

	const stageConnections: JSONSchema = {
		type: "object",
		additionalProperties: {
			type: "object",
			properties: {
				to: {
					type: "array",
					items: { type: "string" },
					description: "Stages this stage can move pubs to",
				},
				from: {
					type: "array",
					items: { type: "string" },
					description: "Stages that can move pubs to this stage",
				},
			},
			additionalProperties: false,
		},
	}

	const user: JSONSchema = {
		type: "object",
		properties: {
			email: {
				type: "string",
				format: "email",
				description: "User email address",
			},
			firstName: { type: "string", description: "User first name" },
			lastName: { type: "string", description: "User last name" },
			avatar: {
				type: "string",
				format: "uri",
				description: "URL to user avatar",
			},
			role: {
				oneOf: [{ enum: [...memberRoles] }, { type: "null" }],
				description: "Community membership role (null for no membership)",
			},
			isSuperAdmin: {
				type: "boolean",
				description: "Whether user is a super admin",
			},
		},
		additionalProperties: false,
	}

	const formElementPubField: JSONSchema = {
		type: "object",
		properties: {
			type: { const: "pubfield" },
			field: {
				type: "string",
				description: "Name of the pub field",
			},
			component: {
				oneOf: [{ enum: [...inputComponents] }, { type: "null" }],
				description: "Input component to use",
			},
			config: {
				type: "object",
				additionalProperties: true,
				description: "Component configuration",
			},
			relatedPubTypes: {
				type: "array",
				items: { type: "string" },
				description: "For relation fields, which pub types can be related",
			},
		},
		required: ["type", "field", "component", "config"],
		additionalProperties: false,
	}

	const formElementStructural: JSONSchema = {
		type: "object",
		properties: {
			type: { const: "structural" },
			element: {
				enum: [...structuralFormElements],
				description: "HTML element type",
			},
			content: {
				type: "string",
				description: "Markdown content",
			},
		},
		required: ["type", "element", "content"],
		additionalProperties: false,
	}

	const formElementButton: JSONSchema = {
		type: "object",
		properties: {
			type: { const: "button" },
			label: {
				type: "string",
				description: "Button label",
			},
			content: {
				type: "string",
				description: "Success message content",
			},
			stage: {
				type: "string",
				description: "Stage to move pub to on submit",
			},
		},
		required: ["type", "label", "content", "stage"],
		additionalProperties: false,
	}

	const formElement: JSONSchema = {
		oneOf: [formElementPubField, formElementStructural, formElementButton],
	}

	const form: JSONSchema = {
		type: "object",
		properties: {
			access: {
				enum: [...formAccessTypes],
				description: "Form access type",
			},
			isArchived: {
				type: "boolean",
				description: "Whether the form is archived",
			},
			slug: {
				type: "string",
				description: "URL-friendly identifier",
			},
			pubType: {
				type: "string",
				description: "Name of the pub type this form creates",
			},
			members: {
				type: "array",
				items: { type: "string" },
				description: "User slugs with form access",
			},
			isDefault: {
				type: "boolean",
				description: "Whether this is the default form for the pub type",
			},
			elements: {
				type: "array",
				items: formElement,
				description: "Form elements",
			},
		},
		required: ["pubType", "elements"],
		additionalProperties: false,
	}

	const pubRef: JSONSchema = {
		$ref: "#/$defs/pub",
	}

	const relatedPub: JSONSchema = {
		type: "object",
		properties: {
			value: {
				description: "Relation metadata value",
			},
			pub: pubRef,
		},
		required: ["pub"],
		additionalProperties: false,
	}

	const pub: JSONSchema = {
		type: "object",
		properties: {
			id: {
				type: "string",
				format: "uuid",
				description: "Optional fixed UUID for the pub",
			},
			pubType: {
				type: "string",
				description: "Name of the pub type",
			},
			values: {
				type: "object",
				additionalProperties: true,
				description: "Field values for the pub",
			},
			stage: {
				type: "string",
				description: "Name of the stage to place the pub in",
			},
			members: {
				type: "object",
				additionalProperties: {
					enum: [...memberRoles],
				},
				description: "User slugs mapped to their roles on this pub",
			},
			relatedPubs: {
				type: "object",
				additionalProperties: {
					type: "array",
					items: relatedPub,
				},
				description: "Related pubs by field name",
			},
		},
		required: ["pubType", "values"],
		additionalProperties: false,
	}

	const apiToken: JSONSchema = {
		type: "object",
		properties: {
			description: {
				type: "string",
				description: "Token description",
			},
			permissions: {
				oneOf: [
					{ const: true, description: "Full permissions" },
					{
						type: "object",
						additionalProperties: true,
						description: "Granular permissions",
					},
				],
			},
		},
		additionalProperties: false,
	}

	const actionConfigDefault: JSONSchema = {
		type: "object",
		properties: {
			action: {
				enum: [...actions],
				description: "The action this config applies to",
			},
			config: {
				type: "object",
				additionalProperties: true,
				description: "Default configuration for the action",
			},
		},
		required: ["action", "config"],
		additionalProperties: false,
	}

	const community: JSONSchema = {
		type: "object",
		properties: {
			name: {
				type: "string",
				minLength: 1,
				description: "Community display name",
			},
			slug: {
				type: "string",
				minLength: 1,
				pattern: "^[a-z0-9-]+$",
				description: "URL-friendly identifier (lowercase, numbers, hyphens)",
			},
			avatar: {
				type: "string",
				format: "uri",
				description: "URL to community avatar image",
			},
		},
		required: ["name", "slug"],
		additionalProperties: false,
	}

	return {
		$schema: "http://json-schema.org/draft-07/schema#",
		title: "Community Template",
		description:
			"Schema for PubPub community templates. Use this to create or copy communities with predefined structure.",
		type: "object",
		$defs: {
			conditionItem,
			pub,
		},
		properties: {
			community: {
				...community,
				description: "Basic community information",
			},
			pubFields: {
				type: "object",
				additionalProperties: pubField,
				description:
					"Pub fields define the schema for data stored in pubs. Keys are field names.",
			},
			pubTypes: {
				type: "object",
				additionalProperties: {
					type: "object",
					additionalProperties: pubTypeField,
					description: "Map of field names to their configuration",
				},
				description:
					"Pub types define the shape of pubs. Keys are type names, values map field names to config.",
			},
			users: {
				type: "object",
				additionalProperties: user,
				description:
					"Users to create. Keys are user slugs used for referencing elsewhere.",
			},
			stages: {
				type: "object",
				additionalProperties: stage,
				description: "Workflow stages. Keys are stage names.",
			},
			stageConnections: {
				...stageConnections,
				description: "Define which stages can move pubs to other stages.",
			},
			pubs: {
				type: "array",
				items: pub,
				description: "Initial pubs to create in the community.",
			},
			forms: {
				type: "object",
				additionalProperties: form,
				description: "Forms for creating and editing pubs. Keys are form titles.",
			},
			apiTokens: {
				type: "object",
				additionalProperties: apiToken,
				description: "API tokens for programmatic access. Keys are token names.",
			},
			actionConfigDefaults: {
				type: "array",
				items: actionConfigDefault,
				description: "Default configurations for actions across the community.",
			},
		},
		required: ["community"],
		additionalProperties: false,
	}
}

// pre-built schema for export
export const communityTemplateSchema = createCommunityTemplateSchema()
