"use server"

import type { CommunitiesId } from "db/public"
import type { TableCommunity } from "./getCommunityTableColumns"

import { revalidatePath } from "next/cache"

import { MemberRole } from "db/public"

import { db } from "~/kysely/database"
import { isUniqueConstraintError } from "~/kysely/errors"
import { getLoginData } from "~/lib/authentication/loginData"
import { createSiteBuilderToken } from "~/lib/server/apiAccessTokens"
import { autoRevalidate } from "~/lib/server/cache/autoRevalidate"
import { defineServerAction } from "~/lib/server/defineServerAction"
import { normalizeAssetUrl } from "~/lib/server/assets"
import { slugifyString } from "~/lib/string"

export const createCommunity = defineServerAction(async function createCommunity({
	name,
	slug,
	avatar,
}: {
	name: string
	slug: string
	avatar?: string | null
}) {
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
	if (slug === "legacy" || slug === "starter") {
		return {
			title: "Failed to remove community",
			error: "Cannot update example community",
		}
	}

	const normalizedAvatar = avatar ? normalizeAssetUrl(avatar) : null

	try {
		const { communityId } = await autoRevalidate(
			db
				.with("new_community", (db) =>
					db
						.insertInto("communities")
						.values({
							name,
							slug: slugifyString(slug),
							avatar: normalizedAvatar,
						})
						.returning("id")
				)
				.insertInto("community_memberships")
				.values((eb) => ({
					userId: user.id,
					communityId: eb.selectFrom("new_community").select("new_community.id"),
					role: MemberRole.admin,
				}))
				.returning(["community_memberships.id", "community_memberships.communityId"]),
			{ communitySlug: slug }
		).executeTakeFirstOrThrow()

		await createSiteBuilderToken(communityId)

		revalidatePath("/")
	} catch (error) {
		if (isUniqueConstraintError(error) && error.constraint === "communities_slug_key") {
			return {
				title: "Failed to create community",
				error: "A community with that slug already exists",
				cause: error,
			}
		}
		return {
			title: "Failed to create community",
			error: "An unexpected error occurred",
			cause: error,
		}
	}
})

export const removeCommunity = defineServerAction(async function removeCommunity({
	community,
}: {
	community: TableCommunity
}) {
	const { user } = await getLoginData()

	if (!user) {
		return {
			title: "Failed to remove community",
			error: "Not logged in",
		}
	}

	if (!user.isSuperAdmin) {
		return {
			title: "Failed to remove community",
			error: "User is not a super admin",
		}
	}

	try {
		await db
			.deleteFrom("communities")
			.where("id", "=", community.id as CommunitiesId)
			.executeTakeFirst()

		revalidatePath("/")
		return
	} catch (error) {
		return {
			title: "Failed to remove community",
			error: "An unexpected error occurred",
			cause: error,
		}
	}
})
