import { Edit } from "lucide-react"
import z from "zod"

import { Action } from "db/public"

import { formSlug, stage } from "../_lib/zodTypes"
import { defineAction } from "../types"

/**
 * Configuration for relating the newly created pub to an existing pub.
 *
 * - `fieldSlug`: The slug of the relation field to use
 * - `relatedPubId`: The ID of the existing pub to relate to (can be a JSONata expression)
 * - `value`: The value to store with the relation (can be a JSONata expression)
 * - `direction`: Which pub gets the relation field value:
 *   - `"source"`: The newly created pub stores the relation (default)
 *   - `"target"`: The existing pub stores the relation to the new pub
 */
export const relationConfigSchema = z
	.object({
		fieldSlug: z.string().describe("The slug of the relation field to use"),
		relatedPubId: z.string().describe("The ID of the existing pub to relate to"),
		value: z.unknown().optional().describe("The value to store with the relation"),
		direction: z
			.enum(["source", "target"])
			.optional()
			.default("source")
			.describe("Which pub gets the relation field value"),
	})
	.optional()

export const action = defineAction({
	name: Action.createPub,
	icon: Edit,
	accepts: ["pub", "json"],
	niceName: "Create Pub",
	description: "Create a new pub",
	config: {
		schema: z.object({
			stage: stage().describe("The stage the new pub will be created in"),
			formSlug: formSlug().describe("The form slug that determines the pub type"),
			pubValues: z.record(z.unknown()),
			relationConfig: relationConfigSchema.describe(
				"Optional configuration for relating the new pub to an existing pub"
			),
		}),
	},
})
