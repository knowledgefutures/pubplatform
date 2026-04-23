import type { ReadStream } from "node:fs"

import type { ProcessedPub } from "contracts"
import type { PageGroup } from "contracts/resources/site-builder-2"

import fs from "node:fs/promises"
import path from "node:path"
import { PassThrough } from "node:stream"
import { S3Client } from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import { serve } from "@hono/node-server"
import { initClient } from "@ts-rest/core"
import { fetchRequestHandler, tsr } from "@ts-rest/serverless/fetch"
import archiver from "archiver"
import { Hono } from "hono"

import { interpolate } from "@pubpub/json-interpolate"
import { createPubProxy, siteApi } from "contracts"
import { siteBuilderApi } from "contracts/resources/site-builder-2"
import { logger } from "logger"
import { tryCatch } from "utils/try-catch"

import { SERVER_ENV } from "./env"

const app = new Hono()
const PORT = SERVER_ENV.PORT

interface ArchiverError extends Error {
	code?: string
}

let s3Client: S3Client

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, "")

const trimLeadingSlashes = (value: string) => value.replace(/^\/+/, "")

const isBucketHost = (hostname: string) =>
	hostname === SERVER_ENV.S3_BUCKET_NAME || hostname.startsWith(`${SERVER_ENV.S3_BUCKET_NAME}.`)

const shouldIncludeBucketInPath = (baseUrl: URL) => {
	const basePath = trimSlashes(baseUrl.pathname)
	const basePathIncludesBucket =
		basePath === SERVER_ENV.S3_BUCKET_NAME ||
		basePath.startsWith(`${SERVER_ENV.S3_BUCKET_NAME}/`)

	if (basePathIncludesBucket) {
		return false
	}

	return !isBucketHost(baseUrl.hostname)
}

const buildS3PublicUrl = (key: string) => {
	const publicEndpoint = SERVER_ENV.S3_PUBLIC_ENDPOINT || SERVER_ENV.S3_ENDPOINT
	const normalizedKey = trimLeadingSlashes(key)

	if (!publicEndpoint) {
		return `https://${SERVER_ENV.S3_BUCKET_NAME}.s3.${SERVER_ENV.S3_REGION}.amazonaws.com/${normalizedKey}`
	}

	const baseUrl = new URL(publicEndpoint)
	const basePath = trimSlashes(baseUrl.pathname)
	const shouldIncludeBucket = shouldIncludeBucketInPath(baseUrl)

	const pathSegments = [
		basePath,
		shouldIncludeBucket ? SERVER_ENV.S3_BUCKET_NAME : null,
		normalizedKey,
	].filter(Boolean)

	baseUrl.pathname = `/${pathSegments.join("/")}`

	return baseUrl.toString()
}

export const getS3Client = () => {
	if (s3Client) {
		return s3Client
	}

	s3Client = new S3Client({
		endpoint: SERVER_ENV.S3_ENDPOINT,
		region: SERVER_ENV.S3_REGION,
		credentials: {
			accessKeyId: SERVER_ENV.S3_ACCESS_KEY,
			secretAccessKey: SERVER_ENV.S3_SECRET_KEY,
		},
		forcePathStyle: !!SERVER_ENV.S3_ENDPOINT,
	})

	return s3Client
}

export const uploadFileToS3 = async (
	id: string,
	fileName: string,
	fileData: Buffer | Uint8Array | ReadStream,
	{
		contentType,
		queueSize,
		partSize,
		progressCallback,
	}: {
		contentType: string
		queueSize?: number
		partSize?: number
		progressCallback?: (progress: any) => void
	}
): Promise<string> => {
	const client = getS3Client()
	const bucket = SERVER_ENV.S3_BUCKET_NAME
	const key = `${id}/${fileName}`

	const parallelUploads3 = new Upload({
		client,
		params: {
			Bucket: bucket,
			Key: key,
			Body: fileData,
			ContentType: contentType,
		},
		queueSize: queueSize ?? 3,
		partSize: partSize ?? 1024 * 1024 * 5,
		leavePartsOnError: false,
	})

	let lastPercentage = 0
	parallelUploads3.on(
		"httpUploadProgress",
		progressCallback ??
			((progress) => {
				if (progress.loaded && progress.total) {
					const percentage = Math.round((progress.loaded / progress.total) * 100)
					if (percentage >= lastPercentage + 5 || percentage === 100) {
						lastPercentage = percentage
					}
				}
			})
	)

	await parallelUploads3.done()

	return buildS3PublicUrl(key)
}

const createZipAndUploadToS3 = async (
	sourceDir: string,
	id: string,
	fileName: string
): Promise<string> => {
	const client = getS3Client()
	const bucket = SERVER_ENV.S3_BUCKET_NAME
	const key = `${id}/${fileName}`

	let totalBytes = 0

	const calculateTotalSize = async (dir: string): Promise<number> => {
		let size = 0
		const entries = await fs.readdir(dir, { withFileTypes: true })
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				size += await calculateTotalSize(fullPath)
			} else {
				const stats = await fs.stat(fullPath)
				size += stats.size
			}
		}
		return size
	}

	try {
		totalBytes = await calculateTotalSize(sourceDir)
	} catch (_err) {
		// Continue with less precise progress reporting
	}

	return new Promise((resolve, reject) => {
		const passThrough = new PassThrough()

		const archive = archiver("zip", {
			zlib: { level: 9 },
		})

		let processedBytes = 0
		let lastPercentage = 0
		archive.pipe(passThrough)

		const upload = new Upload({
			client,
			params: {
				Bucket: bucket,
				Key: key,
				Body: passThrough,
				ContentType: "application/zip",
			},
			queueSize: 4,
			partSize: 1024 * 1024 * 5,
			leavePartsOnError: false,
		})

		let uploadLastPercentage = 0
		upload.on("httpUploadProgress", (progress) => {
			if (progress.loaded && progress.total) {
				const percentage = Math.round((progress.loaded / progress.total) * 100)
				if (percentage >= uploadLastPercentage + 5 || percentage === 100) {
					uploadLastPercentage = percentage
				}
			}
		})

		archive.on("entry", (entry) => {
			if (entry.stats?.size) {
				processedBytes += entry.stats.size
				if (totalBytes > 0) {
					const percentage = Math.round((processedBytes / totalBytes) * 100)
					if (percentage >= lastPercentage + 5 || percentage === 100) {
						lastPercentage = percentage
					}
				}
			}
		})

		archive.on("warning", (err: ArchiverError) => {
			if (err.code !== "ENOENT") {
				reject(err)
			}
		})

		archive.on("error", (err: Error) => {
			reject(err)
		})

		passThrough.on("error", (err) => {
			reject(err)
		})

		upload
			.done()
			.then((result) => {
				resolve(result.Location!)
			})
			.catch((err) => {
				reject(err)
			})

		archive.directory(sourceDir, false)
		archive.finalize()
	})
}

const getContentType = (filePath: string): string => {
	const ext = path.extname(filePath).toLowerCase()
	const contentTypes: Record<string, string> = {
		".html": "text/html",
		".css": "text/css",
		".js": "application/javascript",
		".json": "application/json",
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".gif": "image/gif",
		".svg": "image/svg+xml",
		".webp": "image/webp",
		".woff": "font/woff",
		".woff2": "font/woff2",
		".ttf": "font/ttf",
		".eot": "application/vnd.ms-fontobject",
		".ico": "image/x-icon",
		".xml": "application/xml",
		".txt": "text/plain",
	}
	return contentTypes[ext] ?? "application/octet-stream"
}

const uploadDirectoryToS3 = async (
	sourceDir: string,
	s3Prefix: string
): Promise<{ uploadedFiles: number; s3FolderPath: string; s3FolderUrl: string }> => {
	const client = getS3Client()
	const bucket = SERVER_ENV.S3_BUCKET_NAME
	let uploadedFiles = 0

	const uploadRecursive = async (dir: string, prefix: string): Promise<void> => {
		const entries = await fs.readdir(dir, { withFileTypes: true })
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name)
			const s3Key = `${prefix}/${entry.name}`

			if (entry.isDirectory()) {
				await uploadRecursive(fullPath, s3Key)
			} else {
				const fileData = await fs.readFile(fullPath)
				const contentType = getContentType(fullPath)

				const upload = new Upload({
					client,
					params: {
						Bucket: bucket,
						Key: s3Key,
						Body: fileData,
						ContentType: contentType,
					},
					queueSize: 3,
					partSize: 1024 * 1024 * 5,
					leavePartsOnError: false,
				})

				await upload.done()
				uploadedFiles++
			}
		}
	}

	await uploadRecursive(sourceDir, s3Prefix)

	const s3FolderPath = s3Prefix
	const s3FolderUrl = buildS3PublicUrl(s3Prefix)

	return { uploadedFiles, s3FolderPath, s3FolderUrl }
}

const verifySiteBuilderToken = async (authHeader: string, communitySlug: string) => {
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		throw new Error("Invalid or missing authorization token")
	}

	const client = initClient(siteApi, {
		baseUrl: SERVER_ENV.PUBPUB_URL,
		baseHeaders: {
			Authorization: authHeader,
		},
	})

	const response = await client.auth.check.siteBuilder({
		params: {
			communitySlug: communitySlug,
		},
	})

	if (response.status === 200) {
		return
	}

	if (response.status === 401) {
		return {
			status: 401,
			body: {
				success: false,
				message: `${response.body.code}: ${response.body.reason}`,
			},
		} as const
	}

	throw new Error(`UNKNOWN ERROR: ${response.body}`)
}

// ---- Pub fetching ----

const PUB_BATCH_SIZE = 50

const fetchPubs = async (opts: {
	siteUrl: string
	communitySlug: string
	authToken: string
	pubIds: string[]
}): Promise<ProcessedPub[]> => {
	if (opts.pubIds.length === 0) return []

	const client = initClient(siteApi, {
		baseUrl: opts.siteUrl,
		baseHeaders: {
			Authorization: `Bearer ${opts.authToken}`,
		},
	})

	// Batch pub IDs to avoid URL length limits
	const batches: string[][] = []
	for (let i = 0; i < opts.pubIds.length; i += PUB_BATCH_SIZE) {
		batches.push(opts.pubIds.slice(i, i + PUB_BATCH_SIZE))
	}

	const allPubs: ProcessedPub[] = []
	for (const batch of batches) {
		const response = await client.pubs.getMany({
			params: { communitySlug: opts.communitySlug },
			query: {
				pubIds: batch as any,
				withRelatedPubs: true,
				withPubType: true,
				withValues: true,
				depth: 3,
				limit: batch.length,
			},
		})

		if (response.status !== 200) {
			throw new Error(
				`Failed to fetch pubs: ${(response.body as any)?.message ?? response.status}`
			)
		}

		allPubs.push(...(response.body as ProcessedPub[]))
	}

	return allPubs
}

// ---- SSG rendering ----

const stringifyContent = (content: unknown): string =>
	typeof content === "object" && content !== null
		? JSON.stringify(content, null, 2)
		: String(content ?? "")

const computeSiteBase = (slug: string): string => {
	const depth = slug.split("/").filter(Boolean).length
	return depth === 0 ? "." : Array(depth).fill("..").join("/")
}

const NIL_UUID = "00000000-0000-0000-0000-000000000000"

type RenderedPage = { id: string; title: string; slug: string; content: string }

const renderPageGroup = async (
	group: PageGroup,
	opts: {
		communitySlug: string
		communityId: string
		communityName: string
		siteUrl: string
		authToken: string
	}
): Promise<{ pages: RenderedPage[]; extension: string }> => {
	const extension = group.extension ?? "html"

	// Static mode: no pubs, interpolate with empty context
	if (group.mode === "static") {
		const [slugErr, slug] = await tryCatch(interpolate(group.slugTemplate, {}))
		const interpolatedSlug = (slugErr ? "static" : slug) as string
		const [contentErr, content] = await tryCatch(interpolate(group.transform, {}))
		if (contentErr) logger.error({ msg: "Error interpolating static page", err: contentErr })
		return {
			extension,
			pages: [
				{
					id: NIL_UUID,
					title: interpolatedSlug,
					content: stringifyContent(content),
					slug: interpolatedSlug,
				},
			],
		}
	}

	// Fetch pubs for this group
	const pubs = await fetchPubs({
		siteUrl: opts.siteUrl,
		communitySlug: opts.communitySlug,
		authToken: opts.authToken,
		pubIds: group.pubIds,
	})

	const communityContext = {
		id: opts.communityId,
		name: opts.communityName,
		slug: opts.communitySlug,
	}

	// Single mode: one page with all pubs as $.pubs
	if (group.mode === "single") {
		const pubProxies = pubs.map((p) => createPubProxy(p, opts.communitySlug))
		const context: Record<string, unknown> = {
			pubs: pubProxies,
			community: communityContext,
			env: { PUBPUB_URL: opts.siteUrl },
		}
		const [slugErr, slug] = await tryCatch(interpolate(group.slugTemplate, context))
		const interpolatedSlug = (slugErr ? "index" : slug) as string
		context.site = { base: computeSiteBase(interpolatedSlug) }
		const [contentErr, content] = await tryCatch(interpolate(group.transform, context))
		if (contentErr) logger.error({ msg: "Error interpolating single page", err: contentErr })
		return {
			extension,
			pages: [
				{
					id: NIL_UUID,
					title: interpolatedSlug,
					content: stringifyContent(content),
					slug: interpolatedSlug,
				},
			],
		}
	}

	// Per-pub mode: one page per pub with $.pub in context
	const pages = await Promise.all(
		pubs.map(async (pub) => {
			const pubProxy = createPubProxy(pub, opts.communitySlug)
			const context: Record<string, unknown> = {
				pub: pubProxy,
				community: communityContext,
				env: { PUBPUB_URL: opts.siteUrl },
			}
			const [slugErr, slug] = await tryCatch(interpolate(group.slugTemplate, context))
			if (slugErr) logger.error({ msg: "Error interpolating slug", err: slugErr })
			const interpolatedSlug = (slugErr ? pub.id : slug) as string
			context.site = { base: computeSiteBase(interpolatedSlug) }
			const [contentErr, content] = await tryCatch(interpolate(group.transform, context))
			if (contentErr) logger.error({ msg: "Error interpolating content", err: contentErr })
			return {
				id: pub.id,
				title: pub.title ?? pub.id,
				content: stringifyContent(content),
				slug: interpolatedSlug,
			}
		})
	)

	return { extension, pages }
}

// ---- File writing ----

const renderHtmlPage = (title: string, content: string): string => {
	return `<!DOCTYPE html>
<html lang="en">
<head>
\t<meta charset="UTF-8" />
\t<meta name="viewport" content="width=device-width, initial-scale=1.0" />
\t<title>${title}</title>
</head>
<body>
<div class="site-content">
${content}
</div>
</body>
</html>`
}

const writePages = async (
	renderedGroups: { pages: RenderedPage[]; extension: string }[],
	distDir: string
): Promise<void> => {
	await fs.mkdir(distDir, { recursive: true })

	await Promise.all(
		renderedGroups.map(async (group) => {
			const extension = group.extension ?? "html"
			if (group.pages.length === 0) return

			await Promise.all(
				group.pages.map(async (pageInfo) => {
					const normalized = pageInfo.slug.replace(/\/+$/, "")
					const fileName =
						normalized === ""
							? `index.${extension}`
							: extension === "html"
								? `${normalized}/index.html`
								: `${normalized}.${extension}`
					const isCompleteHtml =
						extension === "html" && pageInfo.content.trimStart().startsWith("<!DOCTYPE")
					const fileContent =
						extension === "html" && !isCompleteHtml
							? renderHtmlPage(pageInfo.title, pageInfo.content)
							: pageInfo.content
					const filePath = path.join(distDir, fileName)
					await fs.mkdir(path.dirname(filePath), { recursive: true })
					await fs.writeFile(filePath, fileContent, "utf-8")
				})
			)
		})
	)
}

// ---- Router ----

const router = tsr.router(siteBuilderApi, {
	build: async ({ body, headers }) => {
		try {
			const authHeader = headers.authorization
			const authToken = authHeader.replace("Bearer ", "")
			const communitySlug = body.communitySlug

			const tokenVerification = await verifySiteBuilderToken(authHeader, communitySlug)

			if (tokenVerification) {
				return tokenVerification
			}

			const timestamp = Date.now()
			const distDir = `./dist/${communitySlug}/${body.automationRunId}`

			try {
				logger.info({
					msg: "Building site",
					communitySlug,
					automationRunId: body.automationRunId,
					pageGroups: body.pageGroups.length,
				})

				// Render all page groups (fetch pubs, interpolate templates)
				const renderedGroups = await Promise.all(
					body.pageGroups.map((group) =>
						renderPageGroup(group, {
							communitySlug,
							communityId: body.communityId,
							communityName: body.communityName,
							siteUrl: body.siteUrl,
							authToken,
						})
					)
				)

				// Write rendered pages to disk
				await writePages(renderedGroups, distDir)

				// Find the first rendered page for the URL
				const firstPage = renderedGroups.flatMap((g) => g.pages)[0]

				const zipFileName = `site-${timestamp}.zip`
				const zipUploadId = "site-archives"
				const zipInternalUrl = await createZipAndUploadToS3(
					distDir,
					zipUploadId,
					zipFileName
				)

				const subpath = body.subpath ?? body.automationRunId
				const s3Prefix = `sites/${communitySlug}/${subpath}`
				const folderUploadResult = await uploadDirectoryToS3(distDir, s3Prefix)

				const publicEndpoint = SERVER_ENV.S3_PUBLIC_ENDPOINT || SERVER_ENV.S3_ENDPOINT
				const zipKey = `${zipUploadId}/${zipFileName}`
				const zipUrl = publicEndpoint ? buildS3PublicUrl(zipKey) : zipInternalUrl

				let publicSiteUrl: string | undefined
				let firstPageUrl: string | undefined

				if (SERVER_ENV.SITES_BASE_URL) {
					const baseUrl = SERVER_ENV.SITES_BASE_URL.replace(/\/$/, "")
					publicSiteUrl = `${baseUrl}/${communitySlug}/${subpath}/`

					if (firstPage) {
						const pageSlug = firstPage.slug || firstPage.id
						firstPageUrl = `${publicSiteUrl}${pageSlug}`
					} else {
						firstPageUrl = publicSiteUrl
					}
				}

				return {
					status: 200,
					body: {
						success: true,
						message: "Site built and uploaded successfully",
						url: zipUrl,
						timestamp,
						s3FolderPath: folderUploadResult.s3FolderPath,
						s3FolderUrl: folderUploadResult.s3FolderUrl,
						siteUrl: publicSiteUrl,
						firstPageUrl,
					},
				}
			} catch (err) {
				const error = err as Error
				logger.error({ msg: "Build failed", error })
				return {
					status: 500,
					body: { success: false, message: `Build failed: ${error.message}` },
				}
			}
		} catch (err) {
			const error = err as Error
			logger.error({ msg: "Build failed", error })
			return {
				status: 500,
				body: {
					success: false,
					message: error.message || "An unknown error occurred",
				},
			}
		}
	},
	health: async () => {
		return {
			status: 200,
			body: {
				status: "ok",
			},
		}
	},
})

app.get("/health", (c) => {
	return c.json({ status: "ok" })
})

app.all("*", async (c) => {
	return fetchRequestHandler({
		request: new Request(c.req.url, c.req.raw),
		contract: siteBuilderApi,
		router,
		options: {},
	})
})

serve({
	fetch: app.fetch,
	port: Number(PORT),
})
