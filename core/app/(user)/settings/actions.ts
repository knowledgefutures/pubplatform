"use server"

import type { UsersId } from "db/public"
import type { z } from "zod"
import type { userInfoFormSchema } from "./schema"

import { revalidatePath } from "next/cache"

import { logger } from "logger"

import { db } from "~/kysely/database"
import { getLoginData } from "~/lib/authentication/loginData"
import { env } from "~/lib/env/env"
import {
	ApiError,
	deleteFileFromS3,
	generateSignedUserAvatarUploadUrl,
	normalizeAssetUrl,
} from "~/lib/server"
import { defineServerAction } from "~/lib/server/defineServerAction"
import { maybeWithTrx } from "~/lib/server/maybeWithTrx"
import { updateUser } from "~/lib/server/user"

export const updateUserInfo = defineServerAction(async function updateUserInfo({
	data,
}: {
	data: z.infer<typeof userInfoFormSchema>
}) {
	const { user } = await getLoginData()
	if (!user) {
		return { error: "You must be logged in to update your user information" }
	}

	if (user.id !== data.id && !user.isSuperAdmin) {
		return { error: "You must be the user to update their information" }
	}

	const { firstName, lastName, email } = data
	try {
		await updateUser({
			id: data.id as UsersId,
			firstName,
			lastName,
			email,
		})

		revalidatePath("/settings")
		return { success: true }
	} catch (error) {
		return { error: error.message }
	}
})

export const uploadUserAvatar = defineServerAction(async function updateAvatar({
	userId,
	fileName,
}: {
	userId: UsersId
	fileName: string
}) {
	if (env.FLAGS?.get("uploads") === false) {
		return ApiError.FEATURE_DISABLED
	}

	const loginData = await getLoginData()

	if (!loginData || !loginData.user) {
		return ApiError.NOT_LOGGED_IN
	}

	if (userId !== loginData.user.id) {
		return ApiError.UNAUTHORIZED
	}

	const signedUrl = await generateSignedUserAvatarUploadUrl(loginData.user.id, fileName)
	logger.debug({ msg: "generated signed url for user avatar upload", fileName, signedUrl })
	return signedUrl
})

export const updateUserAvatar = defineServerAction(async function updateUserAvatar({
	userId,
	fileName,
}: {
	userId: UsersId
	fileName: string | null
}) {
	const { user } = await getLoginData()
	if (!user) {
		return { error: "You must be logged in to update your user information" }
	}

	if (user.id !== userId && !user.isSuperAdmin) {
		return { error: "You must be the user to update their information" }
	}

	try {
		await maybeWithTrx(db, async (trx) => {
			const currentAvatar = user.avatar

			const normalizedAvatar = fileName ? normalizeAssetUrl(fileName) : null

			if (fileName) {
				await updateUser(
					{
						id: userId,
						avatar: normalizedAvatar,
					},
					trx
				)
			} else {
				await updateUser(
					{
						id: userId,
						avatar: null,
					},
					trx
				)
			}

			// make sure user cannot secretely delete any other image
			const doesAvatarContainUserId = currentAvatar?.includes(`/avatars/${userId}/`)
			if (currentAvatar && currentAvatar !== normalizedAvatar && doesAvatarContainUserId) {
				await deleteFileFromS3(currentAvatar)
			}
		})
	} catch (error) {
		return { error: error.message }
	}

	revalidatePath("/settings")
	return { success: true }
})
