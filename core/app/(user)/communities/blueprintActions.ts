"use server"

import type { CommunitiesId } from "db/public"

import { revalidatePath } from "next/cache"

import { MemberRole } from "db/public"
import { logger } from "logger"

import { db } from "~/kysely/database"
import { isUniqueConstraintError } from "~/kysely/errors"
import { getLoginData } from "~/lib/authentication/loginData"
import { exportBlueprint } from "~/lib/server/blueprint/export"
import { importBlueprint } from "~/lib/server/blueprint/import"
import type { Blueprint, BlueprintExportOptions } from "~/lib/server/blueprint/types"
import { BLUEPRINT_VERSION } from "~/lib/server/blueprint/types"
import { defineServerAction } from "~/lib/server/defineServerAction"
import { maybeWithTrx } from "~/lib/server/maybeWithTrx"

export const exportBlueprintAction = defineServerAction(
	async function exportBlueprintAction({
		communityId,
		options = {},
	}: {
		communityId: CommunitiesId
		options?: BlueprintExportOptions
	}) {
		const { user } = await getLoginData()

		if (!user) {
			return { title: "Failed to export blueprint", error: "Not logged in" }
		}

		if (!user.isSuperAdmin) {
			return { title: "Failed to export blueprint", error: "User is not a super admin" }
		}

		try {
			const { blueprint, warnings } = await exportBlueprint(communityId, options)
			return {
				blueprint: JSON.stringify(blueprint, null, 2),
				warnings: warnings.map((w) => `${w.path}: ${w.message}`),
			}
		} catch (error) {
			logger.error({ msg: "Failed to export blueprint", err: error })
			return {
				title: "Failed to export blueprint",
				error: "An unexpected error occurred while exporting",
				cause: error,
			}
		}
	}
)

export const importBlueprintAction = defineServerAction(
	async function importBlueprintAction({
		blueprintJson,
		slugOverride,
		nameOverride,
	}: {
		blueprintJson: string
		slugOverride?: string
		nameOverride?: string
	}) {
		const { user } = await getLoginData()

		if (!user) {
			return { title: "Failed to import blueprint", error: "Not logged in" }
		}

		if (!user.isSuperAdmin) {
			return { title: "Failed to import blueprint", error: "User is not a super admin" }
		}

		let blueprint: Blueprint
		try {
			blueprint = JSON.parse(blueprintJson)
		} catch (error) {
			logger.error("Failed to parse blueprint JSON", { error })
			return { title: "Failed to import blueprint", error: "Invalid JSON", cause: error }
		}

		if (blueprint.version !== BLUEPRINT_VERSION) {
			return {
				title: "Failed to import blueprint",
				error: `Unsupported blueprint version: ${blueprint.version}`,
			}
		}

		try {
			const result = await maybeWithTrx(db, async (trx) => {
				const { communityId, communitySlug, warnings } = await importBlueprint(
					blueprint,
					{
						overrides: {
							slug: slugOverride,
							name: nameOverride,
						},
					},
					trx
				)

				// add current user as admin
				await trx
					.insertInto("community_memberships")
					.values({
						userId: user.id,
						communityId,
						role: MemberRole.admin,
					})
					.execute()

				return { communitySlug, warnings }
			})

			revalidatePath("/")
			return {
				communitySlug: result.communitySlug,
				warnings: result.warnings.map((w) => `${w.path}: ${w.message}`),
			}
		} catch (error) {
			logger.error({ msg: "Failed to import blueprint", err: error })
			if (isUniqueConstraintError(error) && error.constraint === "communities_slug_key") {
				return {
					title: "Failed to import blueprint",
					error: "A community with that slug already exists",
					cause: error,
				}
			}
			return {
				title: "Failed to import blueprint",
				error: "An unexpected error occurred while importing",
				cause: error,
			}
		}
	}
)

export const exportBlueprintAsSeedAction = defineServerAction(
	async function exportBlueprintAsSeedAction({
		communityId,
	}: {
		communityId: CommunitiesId
	}) {
		const { user } = await getLoginData()

		if (!user) {
			return { title: "Failed to export seed", error: "Not logged in" }
		}

		if (!user.isSuperAdmin) {
			return { title: "Failed to export seed", error: "User is not a super admin" }
		}

		try {
			const { exportBlueprint: exportBp } = await import(
				"~/lib/server/blueprint/export"
			)
			const { blueprintToSeedTs } = await import("~/lib/server/blueprint/toSeed")

			const { blueprint, warnings } = await exportBp(communityId, {
				includePubs: true,
				includeApiTokens: true,
				includeActionConfigDefaults: true,
			})
			const seedTs = blueprintToSeedTs(blueprint)
			return {
				seedTs,
				warnings: warnings.map((w) => `${w.path}: ${w.message}`),
			}
		} catch (error) {
			logger.error({ msg: "Failed to export as seed", err: error })
			return {
				title: "Failed to export as seed",
				error: "An unexpected error occurred",
				cause: error,
			}
		}
	}
)

/**
 * analyze a blueprint without importing it, returning a summary of what
 * would be created and any warnings/holes that need filling.
 */
export const analyzeBlueprintAction = defineServerAction(
	async function analyzeBlueprintAction({ blueprintJson }: { blueprintJson: string }) {
		const { user } = await getLoginData()

		if (!user) {
			return { title: "Failed to analyze blueprint", error: "Not logged in" }
		}

		let blueprint: Blueprint
		try {
			blueprint = JSON.parse(blueprintJson)
		} catch {
			return { title: "Failed to analyze blueprint", error: "Invalid JSON" }
		}

		if (blueprint.version !== BLUEPRINT_VERSION) {
			return {
				title: "Failed to analyze blueprint",
				error: `Unsupported blueprint version: ${blueprint.version}`,
			}
		}

		return {
			summary: {
				communityName: blueprint.community.name,
				communitySlug: blueprint.community.slug,
				pubFieldCount: Object.keys(blueprint.pubFields ?? {}).length,
				pubTypeCount: Object.keys(blueprint.pubTypes ?? {}).length,
				stageCount: Object.keys(blueprint.stages ?? {}).length,
				formCount: Object.keys(blueprint.forms ?? {}).length,
				pubCount: Object.keys(blueprint.pubs ?? {}).length,
				apiTokenCount: Object.keys(blueprint.apiTokens ?? {}).length,
				userSlots: Object.entries(blueprint.userSlots ?? {}).map(([name, slot]) => ({
					name,
					role: slot.role ?? null,
					description: slot.description ?? "",
				})),
			},
		}
	}
)
