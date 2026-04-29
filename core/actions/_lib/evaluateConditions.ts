import type { ConditionBlock } from "db/types"

import { interpolate } from "@pubstar/json-interpolate"

import { AutomationConditionBlockType } from "db/public"

type ConditionItem = ConditionBlock["items"][number]
type Condition = Extract<ConditionItem, { kind: "condition" }>

export type ConditionEvaluation = {
	id: string
	expression: string
	evaluatedTo: unknown
	passed: boolean
}

export type BlockFailureReason = {
	blockType: AutomationConditionBlockType
	expectedAllTrue?: boolean
	expectedAnyTrue?: boolean
	expectedFalse?: boolean
	failedConditions: ConditionEvaluation[]
	failedBlocks: BlockFailureReason[]
}

export type FailureMessage = {
	path: string
	message: string
	conditions?: ConditionEvaluation[]
}

export type ConditionEvaluationResult = {
	passed: boolean
	failureReason?: BlockFailureReason
	flatMessages: FailureMessage[]
}

// collect all conditions from the tree
const collectConditions = (block: ConditionBlock): Condition[] => {
	const conditions: Condition[] = []

	for (const item of block.items) {
		if (item.kind === "condition") {
			conditions.push(item)
		} else {
			conditions.push(...collectConditions(item))
		}
	}

	return conditions
}

type EvaluationContext = {
	conditionEvaluations: Map<string, ConditionEvaluation>
	path: string[]
}

type BlockEvaluationResult = {
	passed: boolean
	failureReason?: BlockFailureReason
}

// evaluate a block using pre-computed condition results
const evaluateBlockWithResults = (
	block: ConditionBlock,
	context: EvaluationContext
): BlockEvaluationResult => {
	const { type, items } = block

	if (items.length === 0) {
		return { passed: true }
	}

	const itemResults = items.map((item) => {
		if (item.kind === "condition") {
			const evaluation = context.conditionEvaluations.get(item.id)
			return {
				passed: evaluation?.passed ?? false,
				evaluation,
			}
		}
		return evaluateBlockWithResults(item, context)
	})

	if (type === AutomationConditionBlockType.AND) {
		const allPassed = itemResults.every((result) => result.passed)

		if (!allPassed) {
			const failedConditions: ConditionEvaluation[] = []
			const failedBlocks: BlockFailureReason[] = []

			itemResults.forEach((result) => {
				if (!result.passed) {
					if ("evaluation" in result && result.evaluation) {
						failedConditions.push(result.evaluation)
					} else if ("failureReason" in result && result.failureReason) {
						failedBlocks.push(result.failureReason)
					}
				}
			})

			return {
				passed: false,
				failureReason: {
					blockType: AutomationConditionBlockType.AND,
					expectedAllTrue: true,
					failedConditions,
					failedBlocks,
				},
			}
		}

		return { passed: true }
	}

	if (type === AutomationConditionBlockType.OR) {
		const anyPassed = itemResults.some((result) => result.passed)

		if (!anyPassed) {
			const failedConditions: ConditionEvaluation[] = []
			const failedBlocks: BlockFailureReason[] = []

			itemResults.forEach((result) => {
				if ("evaluation" in result && result.evaluation) {
					failedConditions.push(result.evaluation)
				} else if ("failureReason" in result && result.failureReason) {
					failedBlocks.push(result.failureReason)
				}
			})

			return {
				passed: false,
				failureReason: {
					blockType: AutomationConditionBlockType.OR,
					expectedAnyTrue: true,
					failedConditions,
					failedBlocks,
				},
			}
		}

		return { passed: true }
	}

	if (type === AutomationConditionBlockType.NOT) {
		if (itemResults.length !== 1) {
			return { passed: false }
		}

		const innerPassed = itemResults[0].passed

		if (innerPassed) {
			const failedConditions: ConditionEvaluation[] = []
			const failedBlocks: BlockFailureReason[] = []

			const result = itemResults[0]
			if ("evaluation" in result && result.evaluation) {
				failedConditions.push(result.evaluation)
			} else if ("failureReason" in result && result.failureReason) {
				failedBlocks.push(result.failureReason)
			}

			return {
				passed: false,
				failureReason: {
					blockType: AutomationConditionBlockType.NOT,
					expectedFalse: true,
					failedConditions,
					failedBlocks,
				},
			}
		}

		return { passed: true }
	}

	return { passed: false }
}

// flatten failure reasons into user-friendly messages
const flattenFailureReasons = (
	failureReason: BlockFailureReason,
	path: string[] = []
): FailureMessage[] => {
	const messages: FailureMessage[] = []
	const currentPath = [...path, failureReason.blockType]
	const pathString = currentPath.join(" > ")

	if (failureReason.expectedAllTrue && failureReason.failedConditions.length > 0) {
		const conditionMessages = failureReason.failedConditions
			.map((cond) => {
				return `expression "${cond.expression}" evaluated to ${JSON.stringify(cond.evaluatedTo)} (expected truthy)`
			})
			.join(", ")

		messages.push({
			path: pathString,
			message: `AND block requires all conditions to be true, but ${failureReason.failedConditions.length} failed: ${conditionMessages}`,
			conditions: failureReason.failedConditions,
		})
	}

	if (failureReason.expectedAnyTrue) {
		if (failureReason.failedConditions.length > 0) {
			const conditionMessages = failureReason.failedConditions
				.map((cond) => {
					return `"${cond.expression}" = ${JSON.stringify(cond.evaluatedTo)}`
				})
				.join(", ")

			messages.push({
				path: pathString,
				message: `OR block requires at least one condition to be true, but all ${failureReason.failedConditions.length} failed: ${conditionMessages}`,
				conditions: failureReason.failedConditions,
			})
		}
	}

	if (failureReason.expectedFalse && failureReason.failedConditions.length > 0) {
		const conditionMessages = failureReason.failedConditions
			.map((cond) => {
				return `"${cond.expression}" = ${JSON.stringify(cond.evaluatedTo)}`
			})
			.join(", ")

		messages.push({
			path: pathString,
			message: `NOT block requires condition to be false, but it was true: ${conditionMessages}`,
			conditions: failureReason.failedConditions,
		})
	}

	for (const nestedBlock of failureReason.failedBlocks) {
		messages.push(...flattenFailureReasons(nestedBlock, currentPath))
	}

	return messages
}

export const evaluateConditions = async (
	conditions: ConditionBlock,
	data: unknown
): Promise<ConditionEvaluationResult> => {
	// collect all conditions across all nesting levels
	const allConditions = collectConditions(conditions)

	// evaluate all jsonata expressions in parallel, keeping raw results
	const evaluationPromises = allConditions.map(async (condition) => {
		if (condition.type !== "jsonata") {
			return {
				id: condition.id,
				expression: "",
				rawResult: null,
				booleanResult: false,
			}
		}

		const rawResult = await interpolate(condition.expression, data)
		return {
			id: condition.id,
			expression: condition.expression,
			rawResult,
			booleanResult: !!rawResult,
		}
	})

	const evaluatedResults = await Promise.all(evaluationPromises)

	// build condition evaluations map
	const conditionEvaluations = new Map<string, ConditionEvaluation>()

	for (const { id, expression, rawResult, booleanResult } of evaluatedResults) {
		conditionEvaluations.set(id, {
			id,
			expression,
			evaluatedTo: rawResult,
			passed: booleanResult,
		})
	}

	// evaluate the block structure with pre-computed results
	const context: EvaluationContext = {
		conditionEvaluations,
		path: [],
	}

	const result = evaluateBlockWithResults(conditions, context)

	const flatMessages = result.failureReason ? flattenFailureReasons(result.failureReason) : []

	return {
		passed: result.passed,
		failureReason: result.failureReason,
		flatMessages,
	}
}
