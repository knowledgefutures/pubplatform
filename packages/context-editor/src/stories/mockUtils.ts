import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import fuzzy from "fuzzy"

import initialPubs from "./initialPubs.json"

export const getPubs = async (filter: string) => {
	return fuzzy
		.filter(filter || "", initialPubs, {
			extract: (el) => {
				return el.values["rd:title"]
			},
		})
		.map((result) => result.original)
}

/**
 * getS3Client and generateSignedAssetUploadUrl adapted from https://github.com/pubpub/platform/blob/07ab053760374081b5b61c55c3720e0550e4c289/core/lib/server/assets.ts#L12-L32
 * Used in storybook only so that file uploading can work in stories.
 * Requires minio server to be running
 * */
const getS3Client = () => {
	const region = import.meta.env.STORYBOOK_S3_REGION
	const key = import.meta.env.STORYBOOK_S3_ACCESS_KEY
	const secret = import.meta.env.STORYBOOK_S3_SECRET_KEY

	const s3Client = new S3Client({
		endpoint: import.meta.env.STORYBOOK_S3_ENDPOINT,
		region: region,
		credentials: {
			accessKeyId: key,
			secretAccessKey: secret,
		},
		forcePathStyle: import.meta.env.STORYBOOK_S3_ENDPOINT, // Required for MinIO
	})

	return s3Client
}

export const generateSignedAssetUploadUrl = async (key: string) => {
	const client = getS3Client()

	const bucket = import.meta.env.STORYBOOK_S3_BUCKET_NAME
	const command = new PutObjectCommand({
		Bucket: bucket,
		Key: key,
	})

	const url = await getSignedUrl(client, command, { expiresIn: 3600 })
	return url
}
