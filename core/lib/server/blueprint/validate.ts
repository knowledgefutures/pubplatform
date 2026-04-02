import type { Action, CommunitiesId } from "db/public"

import { db } from "~/kysely/database"
import { findReferenceFields } from "./configRewriter"
import { actions } from "~/actions/api"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AutomationValidationResult = {
	automationId: string
	automationName: string
	stageId: string
	stageName: string
	issues: AutomationValidationIssue[]
}

export type AutomationValidationIssue = {
	actionName: string
	field: string
	message: string
	severity: "error" | "warning"
}

/**
 * validate all action configurations in a community, checking that referenced
 * entities (stages, forms, members) actually exist.
 */
export const validateCommunityActionConfigs = async (
	communityId: CommunitiesId
): Promise<AutomationValidationResult[]> => {
	const [stages, forms, members, automationData] = await Promise.all([
		db
			.selectFrom("stages")
			.select(["id", "name"])
			.where("communityId", "=", communityId)
			.execute(),
		db
			.selectFrom("forms")
			.select(["id", "slug"])
			.where("communityId", "=", communityId)
			.execute(),
		db
			.selectFrom("community_memberships")
			.select(["userId"])
			.where("communityId", "=", communityId)
			.execute(),
		db
			.selectFrom("automations")
			.innerJoin("stages", "stages.id", "automations.stageId")
			.innerJoin("action_instances", "action_instances.automationId", "automations.id")
			.select([
				"automations.id as automationId",
				"automations.name as automationName",
				"automations.stageId",
				"stages.name as stageName",
				"action_instances.action",
				"action_instances.config",
			])
			.where("stages.communityId", "=", communityId)
			.execute(),
	])

	const stageIds = new Set(stages.map((s) => s.id))
	const formSlugs = new Set(forms.map((f) => f.slug))
	const memberIds = new Set(members.map((m) => m.userId))

	const resultsMap = new Map<string, AutomationValidationResult>()

	for (const row of automationData) {
		const config = (row.config ?? {}) as Record<string, unknown>
		const actionDef = actions[row.action as Action]
		if (!actionDef) continue

		const schema = actionDef.config.schema
		const refs = findReferenceFields(schema)
		const issues: AutomationValidationIssue[] = []

		for (const ref of refs) {
			const value = getValueAtPath(config, ref.path)
			if (!value || typeof value !== "string") continue

			if (ref.lookupKey === "stages" && !stageIds.has(value)) {
				issues.push({
					actionName: row.action,
					field: ref.path.join("."),
					message: `references non-existent stage: ${value}`,
					severity: "error",
				})
			}

			if (ref.lookupKey === "forms" && !formSlugs.has(value)) {
				issues.push({
					actionName: row.action,
					field: ref.path.join("."),
					message: `references non-existent form: ${value}`,
					severity: "error",
				})
			}

			if (ref.lookupKey === "members" && !memberIds.has(value)) {
				issues.push({
					actionName: row.action,
					field: ref.path.join("."),
					message: `references non-existent member: ${value}`,
					severity: "warning",
				})
			}
		}

		// scan for any UUID-like strings in non-annotated fields
		scanConfigForOrphanedUuids(config, [], issues, row.action, stageIds, formSlugs, memberIds)

		if (issues.length === 0) continue

		const existing = resultsMap.get(row.automationId)
		if (existing) {
			existing.issues.push(...issues)
		} else {
			resultsMap.set(row.automationId, {
				automationId: row.automationId,
				automationName: row.automationName,
				stageId: row.stageId,
				stageName: row.stageName,
				issues,
			})
		}
	}

	return [...resultsMap.values()]
}

const getValueAtPath = (obj: Record<string, unknown>, path: string[]): unknown => {
	let current: unknown = obj
	for (const key of path) {
		if (current == null || typeof current !== "object") return undefined
		if (key === "[]" || key === "{}") return undefined
		current = (current as Record<string, unknown>)[key]
	}
	return current
}

const scanConfigForOrphanedUuids = (
	obj: unknown,
	path: string[],
	issues: AutomationValidationIssue[],
	actionName: string,
	stageIds: Set<string>,
	formSlugs: Set<string>,
	memberIds: Set<string>
): void => {
	if (typeof obj === "string") {
		if (!UUID_PATTERN.test(obj)) return
		if (stageIds.has(obj) || formSlugs.has(obj) || memberIds.has(obj)) return

		issues.push({
			actionName,
			field: path.join("."),
			message: `contains UUID that does not match any known entity: ${obj}`,
			severity: "warning",
		})
		return
	}

	if (Array.isArray(obj)) {
		for (let i = 0; i < obj.length; i++) {
			scanConfigForOrphanedUuids(
				obj[i],
				[...path, String(i)],
				issues,
				actionName,
				stageIds,
				formSlugs,
				memberIds
			)
		}
		return
	}

	if (typeof obj === "object" && obj != null) {
		for (const [key, value] of Object.entries(obj)) {
			scanConfigForOrphanedUuids(
				value,
				[...path, key],
				issues,
				actionName,
				stageIds,
				formSlugs,
				memberIds
			)
		}
	}
}
