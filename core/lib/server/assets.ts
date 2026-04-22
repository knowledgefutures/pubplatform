import type { CoreSchemaType, PubsId, UsersId } from "db/public"
import type { InputTypeForCoreSchemaType } from "schemas"

import {
	CopyObjectCommand,
	DeleteObjectCommand,
	PutObjectCommand,
	S3Client,
	waitUntilObjectExists,
} from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { sql } from "kysely"

import { logger } from "logger"

import { db } from "~/kysely/database"
import { env } from "../env/env"
import { createLastModifiedBy } from "../lastModifiedBy"
import { getCommunitySlug } from "./cache/getCommunitySlug"

let s3Client: S3Client

export type FileMetadata = InputTypeForCoreSchemaType<CoreSchemaType.FileUpload>[number]

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, "")

const trimLeadingSlashes = (value: string) => value.replace(/^\/+/, "")

const getPublicEndpoint = () => env.S3_PUBLIC_ENDPOINT || env.S3_ENDPOINT

const getPublicUrlStyle = () => env.S3_PUBLIC_URL_STYLE ?? "bucket-path"

const getPathRelativeToBase = (url: URL, baseUrl: string) => {
	const base = new URL(baseUrl)

	if (url.origin !== base.origin) {
		return null
	}

	const basePath = trimSlashes(base.pathname)
	const path = trimSlashes(url.pathname)

	if (!basePath) {
		return path
	}

	if (path === basePath) {
		return ""
	}

	if (!path.startsWith(`${basePath}/`)) {
		return null
	}

	return path.slice(basePath.length + 1)
}

const buildS3PublicUrl = (key: string) => {
	const publicEndpoint = getPublicEndpoint()
	const normalizedKey = trimLeadingSlashes(key)

	if (!publicEndpoint) {
		return `https://${env.S3_BUCKET_NAME}.s3.${env.S3_REGION}.amazonaws.com/${normalizedKey}`
	}

	const baseUrl = new URL(publicEndpoint)
	const basePath = trimSlashes(baseUrl.pathname)

	const shouldIncludeBucket = getPublicUrlStyle() === "bucket-path"

	const pathSegments = [
		basePath,
		shouldIncludeBucket ? env.S3_BUCKET_NAME : null,
		normalizedKey,
	].filter(Boolean)

	baseUrl.pathname = `/${pathSegments.join("/")}`

	return baseUrl.toString()
}

const getS3ObjectKeyCandidates = (fileUrl: string) => {
	try {
		const parsedUrl = new URL(fileUrl)
		const publicEndpoint = getPublicEndpoint()
		const bucket = env.S3_BUCKET_NAME
		const candidates = new Set<string>()

		const addCandidate = (candidate: string | null) => {
			if (!candidate) {
				return
			}

			const normalized = trimLeadingSlashes(candidate)

			if (normalized) {
				candidates.add(normalized)
			}
		}

		const addBucketRelativeCandidate = (candidate: string | null) => {
			if (!candidate) {
				return
			}

			const normalized = trimLeadingSlashes(candidate)
			if (!normalized.startsWith(`${bucket}/`)) {
				return
			}

			addCandidate(normalized.slice(bucket.length + 1))
		}

		if (publicEndpoint) {
			const relativePath = getPathRelativeToBase(parsedUrl, publicEndpoint)
			addBucketRelativeCandidate(relativePath)

			if (getPublicUrlStyle() === "root-path") {
				addCandidate(relativePath)
			}
		}

		const path = trimLeadingSlashes(parsedUrl.pathname)

		if (parsedUrl.hostname === bucket || parsedUrl.hostname.startsWith(`${bucket}.`)) {
			addCandidate(path)
		}

		addBucketRelativeCandidate(path)

		return Array.from(candidates)
	} catch (_err) {
		return []
	}
}

const getS3ObjectKey = (fileUrl: string) => {
	const candidates = getS3ObjectKeyCandidates(fileUrl)

	return candidates[0] ?? null
}

const getTemporaryS3ObjectKey = (fileUrl: string) => {
	const candidates = getS3ObjectKeyCandidates(fileUrl)

	return candidates.find((candidate) => candidate.startsWith("temporary/")) ?? null
}

export const normalizeAssetUrl = (fileUrl: string) => {
	const key = getS3ObjectKey(fileUrl)

	if (!key) {
		return fileUrl
	}

	return buildS3PublicUrl(key)
}

/**
 * Useful for migrating data from other S3 buckets to the new one.
 */
export const generateMetadataFromS3 = async (
	url: string,
	communitySlug: string
): Promise<FileMetadata> => {
	// fetch headers from s3
	const encodedUrl = encodeURI(url)

	const response = await fetch(encodedUrl, { method: "HEAD" })

	if (!response.ok) {
		throw new Error(`failed to fetch metadata from s3: ${response.statusText}`)
	}
	const baseId = `dashboard-${communitySlug}:file`

	const fileName = encodedUrl.split("/").pop() || ""
	const fileSize = parseInt(response.headers.get("content-length") || "0", 10)
	const fileType = response.headers.get("content-type") || "application/octet-stream"

	// generate a deterministic id using the same format as uppy
	const id = `${baseId}-${fileName.replace(/\./g, "-")}-${fileType.replace("/", "-")}-${fileSize}-${Date.now()}`

	return {
		id,
		fileName,
		fileSource: baseId,
		fileType,
		fileSize,
		fileMeta: {
			relativePath: null,
			name: fileName,
			type: fileType,
		},
		fileUploadUrl: encodedUrl,
	}
}

export const getS3Client = () => {
	const region = env.S3_REGION
	const key = env.S3_ACCESS_KEY
	const secret = env.S3_SECRET_KEY

	logger.info({
		msg: "Initializing S3 client",
		endpoint: env.S3_ENDPOINT,
		region,
		key,
		secret,
	})
	if (s3Client) {
		return s3Client
	}

	s3Client = new S3Client({
		endpoint: env.S3_ENDPOINT,
		region: region,
		credentials: {
			accessKeyId: key,
			secretAccessKey: secret,
		},
		forcePathStyle: !!env.S3_ENDPOINT, // Required for MinIO
	})

	logger.info({
		msg: "S3 client initialized",
	})

	return s3Client
}

// we create a separate client for generating signed URLs that uses the public endpoint
// this is bc, when using `minio` locally, the server
// uses `minio:9000`, but for the client this does not make sense
export const getPublicS3Client = () => {
	const region = env.S3_REGION
	const key = env.S3_ACCESS_KEY
	const secret = env.S3_SECRET_KEY
	const publicEndpoint = env.S3_PUBLIC_ENDPOINT || env.S3_ENDPOINT

	return new S3Client({
		endpoint: publicEndpoint,
		region: region,
		credentials: {
			accessKeyId: key,
			secretAccessKey: secret,
		},
		forcePathStyle: !!publicEndpoint, // Required for MinIO
	})
}

export const generateSignedAssetUploadUrl = async (
	userId: UsersId,
	fileName: string,
	kind: "temporary" | "permanent"
) => {
	const communitySlug = await getCommunitySlug()
	const key = `${kind === "temporary" ? "temporary/" : ""}${communitySlug}/${userId}/${crypto.randomUUID()}/${fileName}`

	const client = getPublicS3Client() // use public client for signed URLs

	const bucket = env.S3_BUCKET_NAME
	const command = new PutObjectCommand({
		Bucket: bucket,
		Key: key,
	})

	return await getSignedUrl(
		client,
		command,
		kind === "temporary" ? { expiresIn: 3600 } : undefined
	)
}

const generateSignedUploadUrl = async (key: string) => {
	const client = getPublicS3Client()
	const bucket = env.S3_BUCKET_NAME
	const command = new PutObjectCommand({
		Bucket: bucket,
		Key: key,
	})
	return await getSignedUrl(client, command)
}

export const generateSignedUserAvatarUploadUrl = async (userId: UsersId, fileName: string) => {
	return generateSignedUploadUrl(`avatars/${userId}/${fileName}`)
}

export const generateSignedCommunityAvatarUploadUrl = async (
	communityId: string,
	fileName: string
) => {
	return generateSignedUploadUrl(`avatars/communities/${communityId}/${fileName}`)
}

export const generateSignedTempAvatarUploadUrl = async (fileName: string) => {
	return generateSignedUploadUrl(`avatars/temp/${Date.now()}-${fileName}`)
}

export class InvalidFileUrlError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "InvalidFileUrlError"
	}
}

/**
 * Be very careful with this, always confirm whether the user is allowed to access this file
 */
export const deleteFileFromS3 = async (fileUrl: string) => {
	const client = getPublicS3Client()
	const bucket = env.S3_BUCKET_NAME

	const fileKey = getS3ObjectKey(fileUrl)

	if (!fileKey) {
		logger.error({ msg: "Unable to parse URL of uploaded file", fileUrl })
		throw new InvalidFileUrlError("Unable to parse URL of uploaded file")
	}

	const command = new DeleteObjectCommand({
		Bucket: bucket,
		Key: fileKey,
	})
	logger.info({ msg: "Deleting file from S3", fileKey })
	const res = await client.send(command)
	logger.info({ msg: "File deleted from S3", fileKey })

	return res
}

export const makeFileUploadPermanent = async (
	{
		pubId,
		tempUrl,
		fileName,
		userId,
	}: {
		pubId: PubsId
		tempUrl: string
		fileName: string
		userId: UsersId
	},
	trx = db
) => {
	const source = getTemporaryS3ObjectKey(tempUrl)

	if (!source || !fileName) {
		logger.error({ msg: "Unable to parse URL of uploaded file", pubId, tempUrl })
		throw new Error("Unable to parse URL of uploaded file")
	}

	const newKey = `${pubId}/${fileName}`
	const newFileUrl = buildS3PublicUrl(newKey)

	logger.info({
		msg: "Retrieving S3 clients for makeFileUploadPermanent",
		source,
		newKey,
	})

	const s3Client = getS3Client()

	logger.info({
		msg: "S3 client retrieved for makeFileUploadPermanent. Creating copy command",
		source,
		newKey,
	})

	const copyCommand = new CopyObjectCommand({
		CopySource: `${env.S3_BUCKET_NAME}/${source}`,
		Bucket: env.S3_BUCKET_NAME,
		Key: newKey,
	})

	logger.info({
		msg: "Sending copy command",
		copyCommand,
	})

	await s3Client.send(copyCommand)

	logger.info({
		msg: "Waiting for object to exist",
		newKey,
	})

	await waitUntilObjectExists(
		{
			client: s3Client,
			maxWaitTime: 10,
			minDelay: 1,
		},
		{ Bucket: env.S3_BUCKET_NAME, Key: newKey }
	)
	logger.debug({ msg: "successfully copied temp file to permanent directory", newKey, tempUrl })
	await trx
		.updateTable("pub_values")
		.where("pub_values.pubId", "=", pubId)
		//@ts-expect-error
		.where((eb) => eb.ref("value", "->>").at(0).key("fileUploadUrl"), "=", tempUrl)
		.set((eb) => ({
			value: eb.fn("jsonb_set", [
				"value",
				sql.raw("'{0,fileUploadUrl}'"),
				eb.val(JSON.stringify(newFileUrl)),
			]),
			lastModifiedBy: createLastModifiedBy({ userId }),
		}))
		.execute()

	logger.info({
		msg: "File uploaded permanently",
		newKey,
	})
}

/**
 * Uploads a file to the S3 bucket using the S3 client directly
 * @param id - id under which the file will be stored. eg for a pub, the pubId. for community assets like the logo, the communityId. for user avatars, the userId.
 * @param fileName - name of the file to be stored
 * @param fileData - the file data to upload (Buffer or Uint8Array)
 * @param contentType - MIME type of the file (e.g., 'image/jpeg')
 * @returns the URL of the uploaded file
 */
export const uploadFileToS3 = async (
	id: string,
	fileName: string,
	fileData: Buffer | Uint8Array,
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
	const bucket = env.S3_BUCKET_NAME
	const key = `${id}/${fileName}`

	const parallelUploads3 = new Upload({
		client,
		params: {
			Bucket: bucket,
			Key: key,
			Body: fileData,
			ContentType: contentType,
		},
		queueSize: queueSize ?? 3, // optional concurrency configuration
		partSize: partSize ?? 1024 * 1024 * 5, // optional size of each part, in bytes, at least 5MB
		leavePartsOnError: false, // optional manually handle dropped parts
	})

	parallelUploads3.on(
		"httpUploadProgress",
		progressCallback ??
			((progress) => {
				logger.debug(progress)
			})
	)

	await parallelUploads3.done()

	return buildS3PublicUrl(key)
}
