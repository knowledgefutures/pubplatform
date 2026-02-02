"use server"

import type { CommunitiesId } from "db/public"

import { revalidatePath } from "next/cache"

import { MemberRole } from "db/public"

import type { CommunityTemplate, TemplateExportOptions } from "~/lib/server/communityTemplate"

import { db } from "~/kysely/database"
import { isUniqueConstraintError } from "~/kysely/errors"
import { getLoginData } from "~/lib/authentication/loginData"
import {
	communityTemplateSchema,
	exportCommunityTemplate as exportTemplate,
	validateCommunityTemplateQuick,
} from "~/lib/server/communityTemplate"
import { defineServerAction } from "~/lib/server/defineServerAction"
import { seedCommunity } from "~/prisma/seed/seedCommunity"
import { logger } from "logger"
import { maybeWithTrx } from "~/lib/server/maybeWithTrx"

export const exportCommunityTemplateAction = defineServerAction(
	async function exportCommunityTemplateAction({
		communityId,
		options = {},
	}: {
		communityId: CommunitiesId
		options?: TemplateExportOptions
	}) {
		const { user } = await getLoginData()

		if (!user) {
			return {
				title: "Failed to export template",
				error: "Not logged in",
			}
		}

		if (!user.isSuperAdmin) {
			return {
				title: "Failed to export template",
				error: "User is not a super admin",
			}
		}

		try {
			const template = await exportTemplate(communityId, options)
			return { template: JSON.stringify(template, null, 2) }
		} catch (error) {
			logger.error({ msg: "Failed to export template", err: error })
			return {
				title: "Failed to export template",
				error: "An unexpected error occurred while exporting",
				cause: error,
			}
		}
	}
)

export const createCommunityFromTemplateAction = defineServerAction(
	async function createCommunityFromTemplateAction({ templateJson }: { templateJson: string }) {
		const { user } = await getLoginData()

		if (!user) {
			return {
				title: "Failed to create community",
				error: "Not logged in",
			}
		}

		if (!user.isSuperAdmin) {
			return {
				title: "Failed to create community",
				error: "User is not a super admin",
			}
		}

		let template: CommunityTemplate
		try {
			template = JSON.parse(templateJson)
		} catch (error) {
			logger.error("Failed to create community", { error })
			return {
				title: "Failed to create community",
				error: "Invalid JSON",
				cause: error,
			}
		}

		// validate cross-references
		const validation = validateCommunityTemplateQuick(template)
		if (!validation.valid) {
			return {
				title: "Failed to create community",
				error: `Template validation failed: ${validation.errors.join(", ")}`,
			}
		}

		// transform template to seedCommunity format
		try {
			// build the seed input from the template
			const seedInput = transformTemplateToSeedInput(template, user.id)

			const result= await maybeWithTrx(db, async (trx) => {
			const result = await seedCommunity(seedInput, { randomSlug: false, }, trx)

			// add current user as admin if they werent included
			const userIsMember = Object.values(template.users ?? {}).some(
				(u) => u.email === user.email
			)
			if (!userIsMember) {
				await trx
					.insertInto("community_memberships")
					.values({
						userId: user.id,
						communityId: result.community.id,
						role: MemberRole.admin,
					})
					.execute()
			}

			return result

		})

			revalidatePath("/")
			return { communitySlug: result.community.slug }
		} catch (error) {
			logger.error({ msg: "Failed to create community", err: error })
			if (isUniqueConstraintError(error) && error.constraint === "communities_slug_key") {
				return {
					title: "Failed to create community",
					error: "A community with that slug already exists",
					cause: error,
				}
			}
			return {
				title: "Failed to create community",
				error: "An unexpected error occurred while creating the community",
				cause: error,
			}
		}
	}
)

export const getCommunityTemplateSchemaAction = defineServerAction(
	async function getCommunityTemplateSchemaAction() {
		return { schema: communityTemplateSchema }
	}
)

// transform the template type to the seed input format
// we use 'any' casts because the template types are intentionally looser
// than the seed input types to allow JSON editing, but we've already validated
function transformTemplateToSeedInput(template: CommunityTemplate, _currentUserId: string) {
	const pubFields = template.pubFields ?? {}
	const pubTypes = template.pubTypes ?? {}
	const users = template.users ?? {}
	const stages = template.stages ?? {}
	const stageConnections = template.stageConnections ?? {}
	const forms = template.forms ?? {}
	const pubs = template.pubs ?? []
	const apiTokens = template.apiTokens ?? {}

	const hasUsers = Object.keys(users).length > 0

	// transform users - add passwords if not provided
	// if no users are specified, we skip user/membership creation entirely
	const transformedUsers: Record<string, any> = {}
	for (const [slug, user] of Object.entries(users)) {
		transformedUsers[slug] = {
			...user,
			// generate a random password if not provided
			password: `temp-${crypto.randomUUID()}`,
		}
	}

	// transform stages with automations
	// skip stage members if no users defined in template
	const transformedStages: Record<string, any> = {}
	for (const [name, stage] of Object.entries(stages)) {
		const transformedAutomations: Record<string, any> = {}
		if (stage.automations) {
			for (const [autoName, automation] of Object.entries(stage.automations)) {
				transformedAutomations[autoName] = {
					...automation,
					triggers: automation.triggers.map((t) => ({
						...t,
						config: t.config ?? {},
					})),
					actions: automation.actions.map((a) => ({
						...a,
						config: a.config ?? {},
					})),
				}
			}
		}

		transformedStages[name] = {
			// only include members if users are defined in the template
			...(hasUsers && stage.members ? { members: stage.members } : {}),
			...(Object.keys(transformedAutomations).length > 0
				? { automations: transformedAutomations }
				: {}),
		}
	}

	// transform forms - skip form members if no users defined
	const transformedForms: Record<string, any> = {}
	for (const [name, form] of Object.entries(forms)) {
		transformedForms[name] = {
			...form,
			// only include members if users are defined in the template
			...(hasUsers && form.members ? { members: form.members } : {}),
			elements: form.elements.map((el) => {
				if (el.type === "pubfield") {
					return {
						...el,
						config: el.config ?? {},
					}
				}
				return el
			}),
		}
	}

	// transform pubs - skip pub members if no users defined
	const transformedPubs = pubs.map((pub) => ({
		...pub,
		values: pub.values ?? {},
		// only include members if users are defined in the template
		...(hasUsers && pub.members ? { members: pub.members } : {}),
	}))

	// cast to any since template types are intentionally looser than seed types
	return {
		community: template.community,
		pubFields: pubFields as any,
		pubTypes: pubTypes as any,
		users: transformedUsers,
		stages: transformedStages,
		stageConnections: stageConnections as any,
		forms: transformedForms,
		pubs: transformedPubs as any,
		apiTokens: apiTokens as any,
	}
}
