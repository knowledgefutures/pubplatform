import { initContract } from "@ts-rest/core"
import { z } from "zod"

const contract = initContract()

const pageGroupSchema = z.object({
	/** How this group should be rendered */
	mode: z.enum(["static", "single", "per-pub"]),
	/** Raw JSONata template for page content */
	transform: z.string(),
	/** Raw JSONata expression for the page URL slug */
	slugTemplate: z.string(),
	/** File extension for generated output */
	extension: z.string().default("html"),
	/** Pub IDs matched by the filter (empty for static mode) */
	pubIds: z.array(z.string().uuid()).default([]),
})

export type PageGroup = z.infer<typeof pageGroupSchema>

export const siteBuilderApi = contract.router(
	{
		build: {
			method: "POST",
			path: "/build/site",
			summary: "Build a site",
			headers: z.object({
				// Auth header. For some reason this doesn't work when capitalized.
				authorization: z.string().startsWith("Bearer "),
			}),
			body: z.object({
				automationRunId: z.string().uuid(),
				communitySlug: z.string(),
				communityId: z.string().uuid(),
				communityName: z.string(),
				subpath: z.string().optional(),
				siteUrl: z.string(),
				pageGroups: z.array(pageGroupSchema),
			}),
			description: "Build a journal site",
			responses: {
				200: z.object({
					success: z.literal(true),
					message: z.string(),
					url: z.string(),
					timestamp: z.number(),
					s3FolderUrl: z.string().optional(),
					s3FolderPath: z.string().optional(),
					siteUrl: z.string().optional(),
					firstPageUrl: z.string().optional(),
				}),
				401: z.object({
					success: z.literal(false),
					message: z.string(),
				}),
			},
		},
		health: {
			method: "GET",
			path: "/health",
			summary: "Health check",
			description: "Health check",
			responses: {
				200: z.object({
					status: z.literal("ok"),
				}),
			},
		},
	},
	{
		pathPrefix: "/services/site-builder",
	}
)
