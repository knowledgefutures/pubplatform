"use server"

import { revalidatePath } from "next/cache"

import { getLoginData } from "~/lib/authentication/loginData"
import { resolveFailedMigration, runMigrations } from "~/lib/server/migrate"
import { defineServerAction } from "~/lib/server/defineServerAction"

export const resolveMigration = defineServerAction(async function resolveMigration({
	migrationName,
}: {
	migrationName: string
}) {
	const { user } = await getLoginData()

	if (!user?.isSuperAdmin) {
		return { title: "Unauthorized", error: "Must be a superadmin" }
	}

	const result = await resolveFailedMigration(migrationName)

	if (result.error) {
		return { title: "Failed to resolve migration", error: result.error }
	}

	revalidatePath("/superadmin")
})

export const retryMigrations = defineServerAction(async function retryMigrations() {
	const { user } = await getLoginData()

	if (!user?.isSuperAdmin) {
		return { title: "Unauthorized", error: "Must be a superadmin" }
	}

	try {
		await runMigrations()
	} catch (err) {
		return {
			title: "Migration failed",
			error: err instanceof Error ? err.message : String(err),
		}
	}

	revalidatePath("/superadmin")
})
