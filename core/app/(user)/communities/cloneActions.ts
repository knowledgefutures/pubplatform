"use server"

import type { CommunitiesId } from "db/public"

import { revalidatePath } from "next/cache"

import { MemberRole } from "db/public"

import type { CommunityClone } from "~/lib/server/communityClone"

import { db } from "~/kysely/database"
import { isUniqueConstraintError } from "~/kysely/errors"
import { getLoginData } from "~/lib/authentication/loginData"
import { exportCommunityClone, importCommunityClone } from "~/lib/server/communityClone"
import { defineServerAction } from "~/lib/server/defineServerAction"
import { maybeWithTrx } from "~/lib/server/maybeWithTrx"
import { logger } from "logger"

export const exportCommunityCloneAction = defineServerAction(
	async function exportCommunityCloneAction({ communityId }: { communityId: CommunitiesId }) {
		const { user } = await getLoginData()

		if (!user) {
			return {
				title: "Failed to export clone",
				error: "Not logged in",
			}
		}

		if (!user.isSuperAdmin) {
			return {
				title: "Failed to export clone",
				error: "User is not a super admin",
			}
		}

		try {
			const clone = await exportCommunityClone(communityId)
			return { clone: JSON.stringify(clone, null, 2) }
		} catch (error) {
			logger.error({ msg: "Failed to export clone", err: error })
			return {
				title: "Failed to export clone",
				error: "An unexpected error occurred while exporting",
				cause: error,
			}
		}
	}
)

export const importCommunityCloneAction = defineServerAction(
	async function importCommunityCloneAction({
		cloneJson,
		newSlug,
		newName,
	}: {
		cloneJson: string
		newSlug: string
		newName?: string
	}) {
		const { user } = await getLoginData()

		if (!user) {
			return {
				title: "Failed to import clone",
				error: "Not logged in",
			}
		}

		if (!user.isSuperAdmin) {
			return {
				title: "Failed to import clone",
				error: "User is not a super admin",
			}
		}

		let clone: CommunityClone
		try {
			clone = JSON.parse(cloneJson)
		} catch (error) {
			logger.error("Failed to import clone", { error })
			return {
				title: "Failed to import clone",
				error: "Invalid JSON",
				cause: error,
			}
		}

		// validate version
		if (clone.version !== "1.0") {
			return {
				title: "Failed to import clone",
				error: `Unsupported clone version: ${clone.version}`,
			}
		}

		try {
			const result = await maybeWithTrx(db, async (trx) => {
				const { communityId, mapping } = await importCommunityClone(
					clone,
					{
						newSlug,
						newName,
						issuedById: user.id,
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

				return { communityId, slug: newSlug }
			})

			revalidatePath("/")
			return { communitySlug: result.slug }
		} catch (error) {
			logger.error({ msg: "Failed to import clone", err: error })
			if (isUniqueConstraintError(error) && error.constraint === "communities_slug_key") {
				return {
					title: "Failed to import clone",
					error: "A community with that slug already exists",
					cause: error,
				}
			}
			return {
				title: "Failed to import clone",
				error: "An unexpected error occurred while importing the clone",
				cause: error,
			}
		}
	}
)
