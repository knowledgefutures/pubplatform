"use server"

import type { Json, JsonValue } from "contracts"
import type { PubFieldsId, PubsId, PubTypesId, StagesId } from "db/public"
import type { action } from "./action"

import { interpolate } from "@pubstar/json-interpolate"

import { logger } from "logger"

import { db } from "~/kysely/database"
import { env } from "~/lib/env/env"
import { getCommunity } from "~/lib/server/community"
import { getForm } from "~/lib/server/form"
import {
	createPubRecursiveNew,
	getFieldInfoForSlugs,
	upsertPubRelationValues,
} from "~/lib/server/pub"
import { getStages } from "~/lib/server/stages"
import { buildInterpolationContext } from "../_lib/interpolationContext"
import { extractJsonata, needsInterpolation } from "../_lib/schemaWithJsonFields"
import { defineRun } from "../types"

type PubValueEntry = Json | Date | { value: Json | Date; relatedPubId: PubsId }[]

export const run = defineRun<typeof action>(async (props) => {
	const { config, communityId, lastModifiedBy, automation, stageId } = props
	const { stage, formSlug, pubValues } = config

	try {
		// Get the form, community, and stage to determine the pub type and for interpolation
		const [form, community, stageData] = await Promise.all([
			getForm({ slug: formSlug, communityId }, db).executeTakeFirstOrThrow(),
			getCommunity(communityId),
			getStages({ communityId, stageId, userId: null }).executeTakeFirstOrThrow(),
		])

		if (!community) {
			return {
				title: "Failed to create pub",
				error: "Community not found",
			}
		}

		// build interpolation context with all available data
		const interpolationData = buildInterpolationContext({
			community,
			stage: stageData,
			automation: {
				...automation,
				actionInstances: automation.actionInstances.map((ai) =>
					ai.id === props.actionInstanceId
						? {
								...ai,
								config: config,
							}
						: ai
				),
			},
			automationRun: { id: props.automationRunId },
			user: props.user ?? null,
			env,
			...(props.pub ? { pub: props.pub } : { json: props.json ?? {} }),
		})

		// interpolate any jsonata templates in pubValues
		const interpolatedPubValues: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(pubValues)) {
			if (typeof value === "string" && needsInterpolation(value)) {
				const expression = extractJsonata(value)
				try {
					interpolatedPubValues[key] = await interpolate(expression, interpolationData)
				} catch (error) {
					logger.error({
						msg: "createPub: Failed to interpolate value",
						key,
						expression,
						error,
					})
					return {
						title: "Failed to create pub",
						error: `Failed to interpolate value for field: ${error instanceof Error ? error.message : "Unknown error"}`,
					}
				}
			} else {
				interpolatedPubValues[key] = value
			}
		}

		// Build a map from element ID to field slug for pubfield elements
		const elementIdToFieldSlug = new Map<string, string>()
		const fieldNameToFieldSlug = new Map<string, string>()
		for (const element of form.elements) {
			if (element.type === "pubfield" && element.slug) {
				elementIdToFieldSlug.set(element.id, element.slug)
				if (element.fieldName) {
					fieldNameToFieldSlug.set(element.fieldName, element.slug)
				}
			}
		}

		// Transform pubValues from element IDs to field slugs
		const values: Record<string, PubValueEntry> = {}
		for (const [key, value] of Object.entries(interpolatedPubValues)) {
			// Try element ID first, then field name, then field slug directly
			const fieldSlug =
				elementIdToFieldSlug.get(key) ||
				fieldNameToFieldSlug.get(key) ||
				(key.includes(":") ? key : undefined)

			if (fieldSlug) {
				values[fieldSlug] = value as PubValueEntry
			} else {
				logger.warn({
					msg: "createPub: Unknown element ID or field name in pubValues",
					key,
					formSlug,
				})
			}
		}

		// Create the pub with the specified stage
		const createdPub = await createPubRecursiveNew({
			body: {
				pubTypeId: form.pubTypeId as PubTypesId,
				values,
				stageId: stage as StagesId,
			},
			communityId,
			lastModifiedBy,
		})

		logger.info({
			msg: "createPub: Pub created successfully",
			pubId: createdPub.id,
			formSlug,
			stage,
		})

		// Handle optional relation configuration
		const { relationConfig } = config
		if (relationConfig?.fieldSlug && relationConfig?.relatedPubId) {
			try {
				// Interpolate relatedPubId if it's a JSONata expression
				let resolvedRelatedPubId = relationConfig.relatedPubId
				if (
					typeof relationConfig.relatedPubId === "string" &&
					needsInterpolation(relationConfig.relatedPubId)
				) {
					const expression = extractJsonata(relationConfig.relatedPubId)
					resolvedRelatedPubId = (await interpolate(
						expression,
						interpolationData
					)) as string
				}

				// Interpolate value if it's a JSONata expression
				let resolvedValue: JsonValue = (relationConfig.value as JsonValue) ?? null
				if (
					typeof relationConfig.value === "string" &&
					needsInterpolation(relationConfig.value)
				) {
					const expression = extractJsonata(relationConfig.value)
					resolvedValue = (await interpolate(expression, interpolationData)) as JsonValue
				}

				// Get field info to get the fieldId
				const fieldInfo = await getFieldInfoForSlugs(
					{ slugs: [relationConfig.fieldSlug], communityId },
					db
				)
				if (fieldInfo.length === 0) {
					logger.error({
						msg: "createPub: Relation field not found",
						fieldSlug: relationConfig.fieldSlug,
					})
				} else {
					const fieldId = fieldInfo[0].fieldId as PubFieldsId

					// Determine which pub owns the relation based on direction
					// "source" = new pub stores the relation to existing pub
					// "target" = existing pub stores the relation to new pub
					const direction = relationConfig.direction ?? "source"
					const sourcePubId =
						direction === "source" ? createdPub.id : (resolvedRelatedPubId as PubsId)
					const targetPubId =
						direction === "source" ? (resolvedRelatedPubId as PubsId) : createdPub.id

					await upsertPubRelationValues({
						pubId: sourcePubId,
						allRelationsToCreate: [
							{
								relatedPubId: targetPubId,
								value: resolvedValue,
								fieldId,
							},
						],
						lastModifiedBy,
						trx: db,
					})

					logger.info({
						msg: "createPub: Relation created successfully",
						sourcePubId,
						targetPubId,
						fieldSlug: relationConfig.fieldSlug,
						direction,
					})
				}
			} catch (error) {
				logger.error({
					msg: "createPub: Failed to create relation",
					error,
					relationConfig,
				})
				// Don't fail the whole action if relation creation fails
				// The pub was already created successfully
			}
		}

		return {
			success: true,
			report: `Pub created successfully`,
			data: {
				pubId: createdPub.id,
			},
		}
	} catch (error) {
		logger.error({
			msg: "createPub: Failed to create pub",
			error,
			formSlug,
			stage,
		})

		return {
			title: "Failed to create pub",
			error:
				error instanceof Error ? error.message : "An error occurred while creating the pub",
			cause: error,
		}
	}
})
