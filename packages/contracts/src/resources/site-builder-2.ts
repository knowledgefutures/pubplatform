import { initContract } from "@ts-rest/core"
import { z } from "zod"

const contract = initContract()

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
				subpath: z.string().optional(),
				css: z.string().optional(),
				pages: z.array(
					z.object({
						pages: z.array(
							z.object({
								id: z.string().uuid(),
								title: z.string(),
								slug: z.string(),
								content: z.string(),
							})
						),
						transform: z.string().optional(),
						extension: z.string().default("html"),
					})
				),
				siteUrl: z.string(),
			}),
			description: "Build a journal site",
			responses: {
				200: z.object({
					success: z.literal(true),
					message: z.string(),
					url: z.string(),
					timestamp: z.number(),
					fileSize: z.number(),
					fileSizeFormatted: z.string(),
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
