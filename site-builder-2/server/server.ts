import type { ReadStream } from "node:fs"

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

import { siteApi } from "contracts"
import { siteBuilderApi } from "contracts/resources/site-builder-2"
import { logger } from "logger"

import { SERVER_ENV } from "./env"

const app = new Hono()
const PORT = SERVER_ENV.PORT

interface ArchiverError extends Error {
	code?: string
}

let s3Client: S3Client

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

const _formatBytes = (bytes: number): string => {
	if (bytes === 0) return "0 Bytes"
	const k = 1024
	const sizes = ["Bytes", "KB", "MB", "GB", "TB"]
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
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

	const result = await parallelUploads3.done()
	return result.Location!
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
	let s3FolderUrl: string
	if (SERVER_ENV.S3_ENDPOINT) {
		s3FolderUrl = `${SERVER_ENV.S3_ENDPOINT}/${bucket}/${s3Prefix}`
	} else {
		s3FolderUrl = `https://${bucket}.s3.${SERVER_ENV.S3_REGION}.amazonaws.com/${s3Prefix}`
	}

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

// ---- Bespoke SSG ----

const computeRelativeBase = (slug: string): string => {
	const depth = slug.split("/").filter(Boolean).length
	return depth === 0 ? "." : Array(depth).fill("..").join("/")
}

const renderHtmlPage = (title: string, content: string, hasCss: boolean, slug: string): string => {
	const base = computeRelativeBase(slug)
	const cssLink = hasCss ? `\n\t<link rel="stylesheet" href="${base}/styles.css" />` : ""
	return `<!DOCTYPE html>
<html lang="en">
<head>
\t<meta charset="UTF-8" />
\t<meta name="viewport" content="width=device-width, initial-scale=1.0" />
\t<title>${title}</title>${cssLink}
</head>
<body>
<div class="site-content">
${content}
</div>
</body>
</html>`
}

type PageGroup = {
	pages: { id: string; title: string; slug: string; content: string }[]
	transform?: string
	extension?: string
}

const PUB_BATCH_SIZE = 50

const chunk = <T>(arr: T[], size: number): T[][] =>
	Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
		arr.slice(i * size, i * size + size)
	)

const buildSite = async ({
	communitySlug,
	authToken,
	pages,
	css,
	distDir,
}: {
	communitySlug: string
	authToken: string
	pages: PageGroup[]
	css: string
	distDir: string
}): Promise<void> => {
	const client = initClient(siteApi, {
		baseUrl: SERVER_ENV.PUBPUB_URL,
		baseHeaders: {
			Authorization: `Bearer ${authToken}`,
		},
	})

	await fs.mkdir(distDir, { recursive: true })

	// Write CSS to a separate file if provided
	const hasCss = css.length > 0
	if (hasCss) {
		await fs.writeFile(path.join(distDir, "styles.css"), css, "utf-8")
	}

	const allGeneratedPages: { title: string; slug: string; fileName: string }[] = []

	await Promise.all(
		pages.map(async (group) => {
			const extension = group.extension ?? "html"
			const pubIds = group.pages.map((page) => page.id)

			if (pubIds.length === 0) return

			const pagesByPubId = new Map(group.pages.map((p) => [p.id, p]))

			const writePage = async (pageInfo: { title: string; slug: string; content: string }) => {
				const normalized = pageInfo.slug.replace(/\/+$/, "")
				const fileName =
					normalized === ""
						? `index.${extension}`
						: extension === "html"
							? `${normalized}/index.html`
							: `${normalized}.${extension}`
				// If the content is already a complete HTML document, use it as-is
				const isCompleteHtml = extension === "html" && pageInfo.content.trimStart().startsWith("<!DOCTYPE")
				const fileContent =
					extension === "html" && !isCompleteHtml
						? renderHtmlPage(pageInfo.title, pageInfo.content, hasCss, normalized)
						: pageInfo.content
				const filePath = path.join(distDir, fileName)
				await fs.mkdir(path.dirname(filePath), { recursive: true })
				await fs.writeFile(filePath, fileContent, "utf-8")
				allGeneratedPages.push({ title: pageInfo.title, slug: normalized, fileName })
			}

			if (!group.transform) {
				// Pre-rendered content: use per-page content directly
				await Promise.all(
					group.pages.map(async (page) => writePage(page))
				)
				return
			}

			await Promise.all(
				chunk(pubIds, PUB_BATCH_SIZE).map(async (batch) => {
					const response = await client.pubs.getMany({
						params: { communitySlug },
						query: {
							transform: group.transform,
							pubIds: batch as any,
							limit: batch.length,
						},
					})

					if (response.status !== 200) {
						throw new Error(
							`Failed to fetch pubs. Status: ${response.status} Message: ${(response.body as any)?.message ?? "Unknown error"}`
						)
					}

					await Promise.all(
						response.body.map(async (pub) => {
							const pageInfo = pagesByPubId.get(pub.id)
							if (!pageInfo) return
							const content = (pub as any).content as string
							await writePage({ title: pageInfo.title, slug: pageInfo.slug, content })
						})
					)
				})
			)
		})
	)

	// Auto-generate index.html if none was created by page groups
	const hasIndex = allGeneratedPages.some((p) => p.fileName === "index.html")
	if (!hasIndex && allGeneratedPages.length > 0) {
		// Only show top-level pages (no "/" in slug) on the index
		const topLevelPages = allGeneratedPages.filter((p) => p.slug && !p.slug.includes("/"))
		const pagesToList = topLevelPages.length > 0 ? topLevelPages : allGeneratedPages
		const listItems = pagesToList
			.map((p) => {
				const href = p.slug ? `${p.slug}/index.html` : "./"
				return `<li><a href="${href}">${p.title || p.slug || "Untitled"}</a></li>`
			})
			.join("\n")
		const indexContent = `<h1>Submissions</h1>\n<ul>\n${listItems}\n</ul>`
		const indexPath = path.join(distDir, "index.html")
		await fs.writeFile(indexPath, renderHtmlPage("Index", indexContent, hasCss, ""), "utf-8")
	}
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

			const pages = body.pages
			const css = body.css ?? ""

			try {
				logger.info({
					msg: "Building site",
					communitySlug,
					automationRunId: body.automationRunId,
				})
				await buildSite({
					communitySlug,
					authToken,
					pages,
					css,
					distDir,
				})
			} catch (err) {
				const error = err as Error
				logger.error({ msg: "Build failed", error })
				return {
					status: 500,
					body: { success: false, message: `Build failed: ${error.message}` },
				}
			}

			let zipUploadResult: string | undefined
			let folderUploadResult:
				| { uploadedFiles: number; s3FolderPath: string; s3FolderUrl: string }
				| undefined

			try {
				const zipFileName = `site-${timestamp}.zip`
				const zipUploadId = "site-archives"
				zipUploadResult = await createZipAndUploadToS3(distDir, zipUploadId, zipFileName)

				const subpath = body.subpath ?? body.automationRunId
				const s3Prefix = `sites/${communitySlug}/${subpath}`
				folderUploadResult = await uploadDirectoryToS3(distDir, s3Prefix)

				let publicSiteUrl: string | undefined
				let firstPageUrl: string | undefined
				if (SERVER_ENV.SITES_BASE_URL) {
					const baseUrl = SERVER_ENV.SITES_BASE_URL.replace(/\/$/, "")
					publicSiteUrl = `${baseUrl}/${communitySlug}/${subpath}/`

					const firstPage = pages[0]?.pages?.[0]
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
						url: zipUploadResult,
						timestamp: timestamp,
						fileSize: 0,
						fileSizeFormatted: `${folderUploadResult.uploadedFiles} files uploaded`,
						s3FolderPath: folderUploadResult.s3FolderPath,
						s3FolderUrl: folderUploadResult.s3FolderUrl,
						siteUrl: publicSiteUrl,
						firstPageUrl: firstPageUrl,
					},
				}
			} catch (err) {
				const error = err as Error
				logger.error({ msg: "Build zip upload failed", error })
				return {
					status: 500,
					body: {
						success: false,
						message: error.message || "An unknown error occurred",
						...(zipUploadResult && { url: zipUploadResult }),
					},
				}
			}
		} catch (err) {
			const error = err as Error
			logger.error({ msg: "Build zip upload and folder upload failed", error })
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
