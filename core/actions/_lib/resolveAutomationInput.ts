import type { ProcessedPub } from "contracts"
import type { CommunitiesId } from "db/public"
import type { FullAutomation, Json } from "db/types"
import type { InterpolationContext } from "./interpolationContext"

import jsonata from "jsonata"

import { interpolate } from "@pubpub/json-interpolate"
import { logger } from "logger"
import { tryCatch } from "utils/try-catch"

import { getPubsWithRelatedValues } from "~/lib/server"
import {
	applyJsonataFilter,
	compileJsonataQuery,
	parseJsonataQuery,
} from "~/lib/server/jsonata-query"

type ResolvedPub = ProcessedPub<{
	withPubType: true
	withRelatedPubs: true
	withStage: false
	withValues: true
}>

export type ResolvedInput =
	| { type: "pub"; pub: ResolvedPub }
	| { type: "json"; json: Json }
	| { type: "unchanged" }

/**
 * parses template string to find all {{ }} interpolation blocks
 */
function parseInterpolationBlocks(
	template: string
): { expression: string; startIndex: number; endIndex: number }[] {
	const blocks: { expression: string; startIndex: number; endIndex: number }[] = []
	let i = 0

	while (i < template.length) {
		if (template[i] === "{" && template[i + 1] === "{") {
			const startIndex = i
			i += 2

			let braceDepth = 0
			let expression = ""
			let foundClosing = false

			while (i < template.length) {
				const char = template[i]
				const nextChar = template[i + 1]

				if (char === "}" && nextChar === "}" && braceDepth === 0) {
					foundClosing = true
					blocks.push({
						expression: expression.trim(),
						startIndex,
						endIndex: i + 2,
					})
					i += 2
					break
				}

				if (char === "{") {
					braceDepth++
				} else if (char === "}") {
					braceDepth--
				}

				expression += char
				i++
			}

			if (!foundClosing) {
				throw new Error(`unclosed interpolation block starting at position ${startIndex}`)
			}
		} else {
			i++
		}
	}

	return blocks
}

/**
 * converts a javascript value to a jsonata literal representation
 */
function valueToJsonataLiteral(value: unknown): string {
	if (value === null) {
		return "null"
	}
	if (typeof value === "string") {
		// escape quotes and wrap in quotes
		return JSON.stringify(value)
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value)
	}
	if (Array.isArray(value)) {
		return `[${value.map(valueToJsonataLiteral).join(", ")}]`
	}
	if (typeof value === "object") {
		const entries = Object.entries(value)
			.map(([k, v]) => `"${k}": ${valueToJsonataLiteral(v)}`)
			.join(", ")
		return `{${entries}}`
	}
	return String(value)
}

/**
 * interpolates {{ }} blocks in a resolver expression, replacing them with literal values
 *
 * @example
 * input: `$.pub.values.externalId = {{ $.json.body.articleId }}`
 * context: { json: { body: { articleId: "abc123" } } }
 * output: `$.pub.values.externalId = "abc123"`
 */
async function interpolateResolverExpression(
	expression: string,
	context: InterpolationContext
): Promise<string> {
	const blocks = parseInterpolationBlocks(expression)

	if (blocks.length === 0) {
		return expression
	}

	let result = expression

	// process in reverse order to maintain correct indices
	for (let i = blocks.length - 1; i >= 0; i--) {
		const block = blocks[i]
		const jsonataExpr = jsonata(block.expression)
		const value = await jsonataExpr.evaluate(context)

		if (value === undefined) {
			throw new Error(`resolver interpolation '${block.expression}' returned undefined`)
		}

		const literal = valueToJsonataLiteral(value)
		result = result.slice(0, block.startIndex) + literal + result.slice(block.endIndex)
	}

	return result
}

/**
 * determines if expression is a query (for finding pubs) or a transform (returning json)
 */
function isQueryExpression(expression: string): boolean {
	// queries start with $.pub and contain comparison operators or relation paths
	if (!expression.includes("$.pub")) {
		return false
	}
	// check for comparison operators or relation syntax
	return (
		/\s*(=|!=|<|>|<=|>=|in)\s*/.test(expression) ||
		expression.includes("$.pub.out.") ||
		expression.includes("$.pub.in.") ||
		expression.includes("$search(") ||
		expression.includes("$contains(") ||
		expression.includes("$startsWith(") ||
		expression.includes("$endsWith(") ||
		expression.includes("$exists(")
	)
}

/**
 * resolves the automation input based on a resolver expression.
 *
 * the resolver expression can be:
 * 1. a query to find a pub, e.g. `$.pub.values.externalId = {{ $.json.body.id }}`
 * 2. a transform to restructure the input, e.g. `{ "title": $.json.body.name }`
 *
 * use {{ expr }} syntax to interpolate values from the context into the expression.
 *
 * @param resolver - the resolver expression from the automation
 * @param context - the interpolation context containing pub, json, community, etc.
 * @param communityId - the community ID to search for pubs
 * @param communitySlug - the community slug for field lookups
 * @returns the resolved input (pub, json, or unchanged)
 */
export async function resolveAutomationInput(
	resolver: string,
	context: InterpolationContext,
	communityId: CommunitiesId,
	communitySlug: string
): Promise<ResolvedInput> {
	// first, interpolate any {{ }} blocks
	const [interpolateError, interpolatedExpression] = await tryCatch(
		interpolateResolverExpression(resolver, context)
	)

	if (interpolateError) {
		logger.warn("failed to interpolate resolver expression", {
			resolver,
			error: interpolateError.message,
		})
		return { type: "unchanged" }
	}

	// determine if this is a query (to find a pub) or a transform
	if (isQueryExpression(interpolatedExpression)) {
		// parse and compile the query
		const [parseError, _parsedQuery] = await tryCatch(
			Promise.resolve(parseJsonataQuery(interpolatedExpression))
		)

		if (parseError) {
			logger.warn("failed to parse resolver as query", {
				expression: interpolatedExpression,
				error: parseError.message,
			})
			// fall through to transform mode
		} else {
			const compiled = compileJsonataQuery(interpolatedExpression)

			// execute the query to find a matching pub
			const [queryError, pubs] = await tryCatch(
				getPubsWithRelatedValues(
					{ communityId },
					{
						withPubType: true,
						withRelatedPubs: true,
						withStage: false,
						withValues: true,
						withIncomingRelations: true,
						depth: 3,
						limit: 1,
						customFilter: (eb) => applyJsonataFilter(eb, compiled, { communitySlug }),
					}
				)
			)

			if (queryError) {
				logger.warn("failed to execute resolver query", {
					expression: interpolatedExpression,
					error: queryError.message,
				})
				return { type: "unchanged" }
			}

			if (pubs.length > 0) {
				return { type: "pub", pub: pubs[0] as ResolvedPub }
			}

			logger.debug("no pub found matching resolver query", {
				expression: interpolatedExpression,
			})
			return { type: "unchanged" }
		}
	}

	// treat as a transform expression
	const [transformError, result] = await tryCatch(interpolate(resolver, context))

	if (transformError) {
		logger.error("failed to evaluate resolver transform", {
			resolver,
			error: transformError.message,
		})
		return { type: "unchanged" }
	}

	return { type: "json", json: result as Json }
}

/**
 * checks if an automation has a resolver configured.
 */
export function hasResolver(
	automation: FullAutomation
): automation is FullAutomation & { resolver: string } {
	return Boolean(automation.resolver && automation.resolver.trim().length > 0)
}
