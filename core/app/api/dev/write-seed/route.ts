import type { CommunitiesId } from "db/public"

import { writeFile } from "fs/promises"
import { join } from "path"
import { NextResponse } from "next/server"

import { exportBlueprint } from "~/lib/server/blueprint/export"
import { blueprintToSeedTs } from "~/lib/server/blueprint/toSeed"

/**
 * dev-only endpoint that exports a community as a blueprint and writes it
 * as a TypeScript seed file to core/prisma/seeds/<slug>.ts.
 *
 * POST /api/dev/write-seed
 * body: { communityId: string }
 */
export async function POST(request: Request) {
	// eslint-disable-next-line no-restricted-properties
	if (process.env.NODE_ENV !== "development") {
		return NextResponse.json(
			{ error: "this endpoint is only available in development mode" },
			{ status: 403 }
		)
	}

	const body = (await request.json()) as { communityId?: string }

	if (!body.communityId) {
		return NextResponse.json({ error: "communityId is required" }, { status: 400 })
	}

	const communityId = body.communityId as CommunitiesId

	const { blueprint, warnings } = await exportBlueprint(communityId, {
		includePubs: true,
		includeApiTokens: true,
		includeActionConfigDefaults: true,
	})

	const tsContent = blueprintToSeedTs(blueprint)

	const seedsDir = join(process.cwd(), "prisma", "seeds")
	const filename = `${blueprint.community.slug}.ts`
	const filepath = join(seedsDir, filename)

	await writeFile(filepath, tsContent, "utf-8")

	return NextResponse.json({
		written: filepath,
		slug: blueprint.community.slug,
		warnings: warnings.map((w) => `${w.path}: ${w.message}`),
	})
}
