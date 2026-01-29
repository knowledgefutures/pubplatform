import type { ValidationError } from "ui/monaco"

import type { CommunityTemplate, TemplateFormElement, TemplatePub } from "./types"

export type TemplateValidationResult = {
	valid: boolean
	errors: ValidationError[]
}

type ValidationContext = {
	template: CommunityTemplate
	json: string
	userSlugs: Set<string>
	fieldNames: Set<string>
	pubTypeNames: Set<string>
	stageNames: Set<string>
	formTitles: Set<string>
}

// find line and column for a json path in the original string
const findPositionForPath = (
	json: string,
	path: string[]
): { line: number; column: number } => {
	const lines = json.split("\n")
	let currentLine = 1
	let currentCol = 1
	let depth = 0
	let inString = false
	let escapeNext = false
	let currentKey = ""
	let buildingKey = false
	let pathIndex = 0
	let foundPath: string[] = []

	for (let i = 0; i < json.length; i++) {
		const char = json[i]

		if (char === "\n") {
			currentLine++
			currentCol = 1
			continue
		}

		currentCol++

		if (escapeNext) {
			escapeNext = false
			continue
		}

		if (char === "\\") {
			escapeNext = true
			continue
		}

		if (char === '"' && !escapeNext) {
			if (!inString) {
				inString = true
				buildingKey = true
				currentKey = ""
			} else {
				inString = false
				if (buildingKey) {
					buildingKey = false
				}
			}
			continue
		}

		if (inString) {
			if (buildingKey) {
				currentKey += char
			}
			continue
		}

		if (char === ":") {
			if (foundPath.length === pathIndex && currentKey === path[pathIndex]) {
				foundPath.push(currentKey)
				pathIndex++
				if (pathIndex === path.length) {
					return { line: currentLine, column: currentCol }
				}
			}
		}

		if (char === "{" || char === "[") {
			depth++
		}

		if (char === "}" || char === "]") {
			depth--
			if (foundPath.length > depth) {
				foundPath = foundPath.slice(0, depth)
				pathIndex = foundPath.length
			}
		}
	}

	return { line: 1, column: 1 }
}

// simple path finder that looks for a key pattern
const findKeyPosition = (
	json: string,
	keyPattern: string
): { line: number; column: number } => {
	const lines = json.split("\n")
	const regex = new RegExp(`"${keyPattern}"\\s*:`)

	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(regex)
		if (match && match.index !== undefined) {
			return { line: i + 1, column: match.index + 1 }
		}
	}

	return { line: 1, column: 1 }
}

const validateUserReferences = (ctx: ValidationContext): ValidationError[] => {
	const errors: ValidationError[] = []

	// check stage members
	if (ctx.template.stages) {
		for (const [stageName, stage] of Object.entries(ctx.template.stages)) {
			if (!stage.members) continue

			for (const userSlug of Object.keys(stage.members)) {
				if (!ctx.userSlugs.has(userSlug)) {
					const pos = findKeyPosition(ctx.json, userSlug)
					errors.push({
						message: `User "${userSlug}" referenced in stage "${stageName}" members does not exist in users`,
						...pos,
						severity: "error",
					})
				}
			}
		}
	}

	// check pub members
	if (ctx.template.pubs) {
		for (let i = 0; i < ctx.template.pubs.length; i++) {
			const pub = ctx.template.pubs[i]
			if (!pub.members) continue

			for (const userSlug of Object.keys(pub.members)) {
				if (!ctx.userSlugs.has(userSlug)) {
					const pos = findKeyPosition(ctx.json, userSlug)
					errors.push({
						message: `User "${userSlug}" referenced in pub #${i + 1} members does not exist in users`,
						...pos,
						severity: "error",
					})
				}
			}
		}
	}

	// check form members
	if (ctx.template.forms) {
		for (const [formTitle, form] of Object.entries(ctx.template.forms)) {
			if (!form.members) continue

			for (const userSlug of form.members) {
				if (!ctx.userSlugs.has(userSlug)) {
					const pos = findKeyPosition(ctx.json, userSlug)
					errors.push({
						message: `User "${userSlug}" referenced in form "${formTitle}" members does not exist in users`,
						...pos,
						severity: "error",
					})
				}
			}
		}
	}

	return errors
}

const validateFieldReferences = (ctx: ValidationContext): ValidationError[] => {
	const errors: ValidationError[] = []

	// check pub type fields reference existing pub fields
	if (ctx.template.pubTypes) {
		for (const [pubTypeName, fields] of Object.entries(ctx.template.pubTypes)) {
			for (const fieldName of Object.keys(fields)) {
				if (!ctx.fieldNames.has(fieldName)) {
					const pos = findKeyPosition(ctx.json, fieldName)
					errors.push({
						message: `Field "${fieldName}" in pub type "${pubTypeName}" does not exist in pubFields`,
						...pos,
						severity: "error",
					})
				}
			}
		}
	}

	// check form elements reference existing fields
	if (ctx.template.forms) {
		for (const [formTitle, form] of Object.entries(ctx.template.forms)) {
			for (const element of form.elements) {
				if (element.type === "pubfield" && element.field) {
					if (!ctx.fieldNames.has(element.field)) {
						const pos = findKeyPosition(ctx.json, element.field)
						errors.push({
							message: `Field "${element.field}" in form "${formTitle}" does not exist in pubFields`,
							...pos,
							severity: "error",
						})
					}
				}
			}
		}
	}

	return errors
}

const validatePubTypeReferences = (ctx: ValidationContext): ValidationError[] => {
	const errors: ValidationError[] = []

	// check form pubType references
	if (ctx.template.forms) {
		for (const [formTitle, form] of Object.entries(ctx.template.forms)) {
			if (!ctx.pubTypeNames.has(form.pubType)) {
				const pos = findKeyPosition(ctx.json, form.pubType)
				errors.push({
					message: `Pub type "${form.pubType}" in form "${formTitle}" does not exist in pubTypes`,
					...pos,
					severity: "error",
				})
			}

			// check relatedPubTypes in form elements
			for (const element of form.elements) {
				if (element.type === "pubfield" && element.relatedPubTypes) {
					for (const relatedType of element.relatedPubTypes) {
						if (!ctx.pubTypeNames.has(relatedType)) {
							const pos = findKeyPosition(ctx.json, relatedType)
							errors.push({
								message: `Related pub type "${relatedType}" in form "${formTitle}" does not exist in pubTypes`,
								...pos,
								severity: "error",
							})
						}
					}
				}
			}
		}
	}

	// check pub pubType references
	const validatePubType = (pub: TemplatePub, index: number, parentPath: string) => {
		if (!ctx.pubTypeNames.has(pub.pubType)) {
			const pos = findKeyPosition(ctx.json, pub.pubType)
			errors.push({
				message: `Pub type "${pub.pubType}" in ${parentPath} does not exist in pubTypes`,
				...pos,
				severity: "error",
			})
		}

		// check nested related pubs
		if (pub.relatedPubs) {
			for (const [fieldName, relatedPubs] of Object.entries(pub.relatedPubs)) {
				for (let j = 0; j < relatedPubs.length; j++) {
					validatePubType(relatedPubs[j].pub, j, `${parentPath}.relatedPubs.${fieldName}[${j}]`)
				}
			}
		}
	}

	if (ctx.template.pubs) {
		for (let i = 0; i < ctx.template.pubs.length; i++) {
			validatePubType(ctx.template.pubs[i], i, `pubs[${i}]`)
		}
	}

	return errors
}

const validateStageReferences = (ctx: ValidationContext): ValidationError[] => {
	const errors: ValidationError[] = []

	// check pub stage references
	const validatePubStage = (pub: TemplatePub, index: number, parentPath: string) => {
		if (pub.stage && !ctx.stageNames.has(pub.stage)) {
			const pos = findKeyPosition(ctx.json, pub.stage)
			errors.push({
				message: `Stage "${pub.stage}" in ${parentPath} does not exist in stages`,
				...pos,
				severity: "error",
			})
		}

		// check nested related pubs
		if (pub.relatedPubs) {
			for (const [fieldName, relatedPubs] of Object.entries(pub.relatedPubs)) {
				for (let j = 0; j < relatedPubs.length; j++) {
					validatePubStage(relatedPubs[j].pub, j, `${parentPath}.relatedPubs.${fieldName}[${j}]`)
				}
			}
		}
	}

	if (ctx.template.pubs) {
		for (let i = 0; i < ctx.template.pubs.length; i++) {
			validatePubStage(ctx.template.pubs[i], i, `pubs[${i}]`)
		}
	}

	// check stage connections
	if (ctx.template.stageConnections) {
		for (const [stageName, connections] of Object.entries(ctx.template.stageConnections)) {
			if (!ctx.stageNames.has(stageName)) {
				const pos = findKeyPosition(ctx.json, stageName)
				errors.push({
					message: `Stage "${stageName}" in stageConnections does not exist in stages`,
					...pos,
					severity: "error",
				})
			}

			if (connections.to) {
				for (const toStage of connections.to) {
					if (!ctx.stageNames.has(toStage)) {
						const pos = findKeyPosition(ctx.json, toStage)
						errors.push({
							message: `Target stage "${toStage}" in stageConnections.${stageName}.to does not exist in stages`,
							...pos,
							severity: "error",
						})
					}
				}
			}

			if (connections.from) {
				for (const fromStage of connections.from) {
					if (!ctx.stageNames.has(fromStage)) {
						const pos = findKeyPosition(ctx.json, fromStage)
						errors.push({
							message: `Source stage "${fromStage}" in stageConnections.${stageName}.from does not exist in stages`,
							...pos,
							severity: "error",
						})
					}
				}
			}
		}
	}

	// check form button stage references
	if (ctx.template.forms) {
		for (const [formTitle, form] of Object.entries(ctx.template.forms)) {
			for (const element of form.elements) {
				if (element.type === "button" && element.stage) {
					if (!ctx.stageNames.has(element.stage)) {
						const pos = findKeyPosition(ctx.json, element.stage)
						errors.push({
							message: `Stage "${element.stage}" in form "${formTitle}" button does not exist in stages`,
							...pos,
							severity: "error",
						})
					}
				}
			}
		}
	}

	return errors
}

const validateAutomationReferences = (ctx: ValidationContext): ValidationError[] => {
	const errors: ValidationError[] = []

	if (!ctx.template.stages) return errors

	for (const [stageName, stage] of Object.entries(ctx.template.stages)) {
		if (!stage.automations) continue

		const automationNames = new Set(Object.keys(stage.automations))

		for (const [automationName, automation] of Object.entries(stage.automations)) {
			// check sourceAutomation references
			if (automation.sourceAutomation) {
				if (!automationNames.has(automation.sourceAutomation)) {
					const pos = findKeyPosition(ctx.json, automation.sourceAutomation)
					errors.push({
						message: `Source automation "${automation.sourceAutomation}" in ${stageName}.${automationName} does not exist`,
						...pos,
						severity: "error",
					})
				}
			}

			// check trigger sourceAutomation references
			for (const trigger of automation.triggers) {
				if (trigger.sourceAutomation && !automationNames.has(trigger.sourceAutomation)) {
					const pos = findKeyPosition(ctx.json, trigger.sourceAutomation)
					errors.push({
						message: `Source automation "${trigger.sourceAutomation}" in trigger does not exist`,
						...pos,
						severity: "error",
					})
				}
			}
		}
	}

	return errors
}

export const validateCommunityTemplate = (
	jsonString: string
): TemplateValidationResult => {
	let template: CommunityTemplate

	try {
		template = JSON.parse(jsonString)
	} catch (e) {
		// json parse errors are handled by monaco's built-in json validation
		return { valid: true, errors: [] }
	}

	const ctx: ValidationContext = {
		template,
		json: jsonString,
		userSlugs: new Set(Object.keys(template.users ?? {})),
		fieldNames: new Set(Object.keys(template.pubFields ?? {})),
		pubTypeNames: new Set(Object.keys(template.pubTypes ?? {})),
		stageNames: new Set(Object.keys(template.stages ?? {})),
		formTitles: new Set(Object.keys(template.forms ?? {})),
	}

	const errors: ValidationError[] = [
		...validateUserReferences(ctx),
		...validateFieldReferences(ctx),
		...validatePubTypeReferences(ctx),
		...validateStageReferences(ctx),
		...validateAutomationReferences(ctx),
	]

	return {
		valid: errors.length === 0,
		errors,
	}
}

// quick validation without line numbers (for server-side)
export const validateCommunityTemplateQuick = (
	template: CommunityTemplate
): { valid: boolean; errors: string[] } => {
	const errors: string[] = []

	const userSlugs = new Set(Object.keys(template.users ?? {}))
	const fieldNames = new Set(Object.keys(template.pubFields ?? {}))
	const pubTypeNames = new Set(Object.keys(template.pubTypes ?? {}))
	const stageNames = new Set(Object.keys(template.stages ?? {}))

	// check pub type field references
	if (template.pubTypes) {
		for (const [pubTypeName, fields] of Object.entries(template.pubTypes)) {
			for (const fieldName of Object.keys(fields)) {
				if (!fieldNames.has(fieldName)) {
					errors.push(`Field "${fieldName}" in pub type "${pubTypeName}" does not exist`)
				}
			}
		}
	}

	// check form pub type references
	if (template.forms) {
		for (const [formTitle, form] of Object.entries(template.forms)) {
			if (!pubTypeNames.has(form.pubType)) {
				errors.push(`Pub type "${form.pubType}" in form "${formTitle}" does not exist`)
			}
		}
	}

	// check stage member references
	if (template.stages) {
		for (const [stageName, stage] of Object.entries(template.stages)) {
			if (stage.members) {
				for (const userSlug of Object.keys(stage.members)) {
					if (!userSlugs.has(userSlug)) {
						errors.push(`User "${userSlug}" in stage "${stageName}" does not exist`)
					}
				}
			}
		}
	}

	// check pub references
	if (template.pubs) {
		for (let i = 0; i < template.pubs.length; i++) {
			const pub = template.pubs[i]
			if (!pubTypeNames.has(pub.pubType)) {
				errors.push(`Pub type "${pub.pubType}" in pubs[${i}] does not exist`)
			}
			if (pub.stage && !stageNames.has(pub.stage)) {
				errors.push(`Stage "${pub.stage}" in pubs[${i}] does not exist`)
			}
		}
	}

	return { valid: errors.length === 0, errors }
}
