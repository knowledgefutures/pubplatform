"use server"

import type { CommunitiesId } from "db/public"
import type { z } from "zod"
import type { communitySettingsSchema } from "./schema"

import { revalidatePath, revalidateTag } from "next/cache"
import { cookies } from "next/headers"

import { Capabilities, MembershipType } from "db/public"
import { logger } from "logger"

import { LAST_VISITED_COOKIE } from "~/app/components/LastVisitedCommunity/constants"
import { db } from "~/kysely/database"
import { getLoginData } from "~/lib/authentication/loginData"
import { userCan } from "~/lib/authorization/capabilities"
import { env } from "~/lib/env/env"
import { ApiError, deleteFileFromS3, normalizeAssetUrl } from "~/lib/server"
import { generateSignedCommunityAvatarUploadUrl } from "~/lib/server/assets"
import { getCommunitySlug } from "~/lib/server/cache/getCommunitySlug"
import { updateCommunity } from "~/lib/server/community"
import { defineServerAction } from "~/lib/server/defineServerAction"
import { maybeWithTrx } from "~/lib/server/maybeWithTrx"

export const updateCommunitySettings = defineServerAction(async function updateCommunitySettings({
	data,
}: {
	data: z.infer<typeof communitySettingsSchema>
}) {
	const { user } = await getLoginData()
	if (!user) {
		return { error: "You must be logged in to update community settings" }
	}

	const canEdit = await userCan(
		Capabilities.editCommunity,
		{ type: MembershipType.community, communityId: data.id as CommunitiesId },
		user.id
	)

	if (!canEdit) {
		return { error: "You do not have permission to edit this community" }
	}

	const { name } = data
	try {
		await updateCommunity({
			id: data.id as CommunitiesId,
			name,
		})

		revalidatePath(`/c/[communitySlug]/settings/community`, "page")
		return { success: true }
	} catch (error) {
		return { error: error.message }
	}
})

export const uploadCommunityAvatar = defineServerAction(async function uploadCommunityAvatar({
	communityId,
	fileName,
}: {
	communityId: CommunitiesId
	fileName: string
}) {
	if (env.FLAGS?.get("uploads") === false) {
		return ApiError.FEATURE_DISABLED
	}

	const loginData = await getLoginData()

	if (!loginData || !loginData.user) {
		return ApiError.NOT_LOGGED_IN
	}

	const canEdit = await userCan(
		Capabilities.editCommunity,
		{ type: MembershipType.community, communityId },
		loginData.user.id
	)

	if (!canEdit) {
		return ApiError.UNAUTHORIZED
	}

	const signedUrl = await generateSignedCommunityAvatarUploadUrl(communityId, fileName)
	logger.debug({ msg: "generated signed url for community avatar upload", fileName, signedUrl })
	return signedUrl
})

export const updateCommunityAvatar = defineServerAction(async function updateCommunityAvatar({
	communityId,
	fileName,
}: {
	communityId: CommunitiesId
	fileName: string | null
}) {
	const { user } = await getLoginData()
	if (!user) {
		return { error: "You must be logged in to update community settings" }
	}

	const canEdit = await userCan(
		Capabilities.editCommunity,
		{ type: MembershipType.community, communityId },
		user.id
	)

	if (!canEdit) {
		return { error: "You do not have permission to edit this community" }
	}

	await maybeWithTrx(db, async (trx) => {
		const community = await db
			.selectFrom("communities")
			.select("avatar")
			.where("id", "=", communityId)
			.executeTakeFirst()

		const currentAvatar = community?.avatar
		const normalizedAvatar = fileName ? normalizeAssetUrl(fileName) : null

		if (fileName) {
			await updateCommunity(
				{
					id: communityId,
					avatar: normalizedAvatar,
				},
				trx
			)
		} else {
			await updateCommunity(
				{
					id: communityId,
					avatar: null,
				},
				trx
			)
		}

		const doesAvatarContainCommunityId = currentAvatar?.includes(
			`/avatars/communities/${communityId}/`
		)
		if (currentAvatar && currentAvatar !== normalizedAvatar && doesAvatarContainCommunityId) {
			await deleteFileFromS3(currentAvatar)
		}
	})

	revalidatePath(`/c/[communitySlug]/settings/community`, "page")
	return { success: true }
})

export const deleteCommunity = defineServerAction(async function deleteCommunity({
	communityId,
}: {
	communityId: CommunitiesId
}) {
	const { user } = await getLoginData()
	if (!user) {
		return { error: "You must be logged in to delete a community" }
	}

	const communitySlug = await getCommunitySlug()

	const canEdit = await userCan(
		Capabilities.editCommunity,
		{ type: MembershipType.community, communityId },
		user.id
	)

	if (!canEdit) {
		return { error: "You do not have permission to delete this community" }
	}

	try {
		await db.deleteFrom("communities").where("id", "=", communityId).execute()
		revalidateTag(`community-all_${communitySlug}`)
		// remove cookie
		const cookieStore = await cookies()
		cookieStore.delete(LAST_VISITED_COOKIE)

		return { success: true }
	} catch (error) {
		logger.error({ msg: "Failed to delete community", error })
		return { error: error instanceof Error ? error.message : "Failed to delete community" }
	}
})
