import type { AuthTokenType, UsersId } from "db/public"

import { db } from "~/kysely/database"
import { env } from "../env/env"
import { createToken } from "../server/token"

type NativeMagicLinkOptions = {
	userId: UsersId
	type: AuthTokenType
	expiresAt: Date
	path: `/${string}`
}

export const createMagicLink = async (options: NativeMagicLinkOptions, trx = db) => {
	const token = await createToken(
		{
			userId: options.userId,
			type: options.type,
			expiresAt: options.expiresAt,
		},
		trx
	)

	return constructMagicLink(token, options.path)
}

export const constructMagicLink = (token: string, path: `/${string}`) => {
	return `${env.PUBSTAR_URL}/magic-link?token=${token}&redirectTo=${encodeURIComponent(path)}`
}
