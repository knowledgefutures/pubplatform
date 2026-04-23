"use client"

import type { Meta } from "@uppy/core"

import React, { forwardRef, useEffect, useState } from "react"
import Uppy from "@uppy/core"
import { Dashboard } from "@uppy/react"

// import "./fileUpload.css";
// TODO: impot on prod?
import "@uppy/core/dist/style.min.css"
import "@uppy/dashboard/dist/style.min.css"

import type { AwsBody } from "@uppy/aws-s3"
import type { Restrictions } from "@uppy/core/lib/Restricter"

import AwsS3Multipart from "@uppy/aws-s3"

const pluginName = "AwsS3Multipart" as const

export type SignedUploadTarget = {
	signedUrl: string
	publicUrl: string
}

export type UploadResponse = string | SignedUploadTarget | { error: string }

export type FormattedFile = {
	id: string
	fileName: string
	fileSource: string
	fileType: string
	fileSize: number | null
	fileMeta: Meta
	fileUploadUrl?: string
	filePreview?: string
}

export type FileUploadProps = {
	upload: (fileName: string) => Promise<UploadResponse>
	onUpdateFiles: (files: FormattedFile[]) => void
	disabled?: boolean
	id?: string
	restrictions?: Partial<Restrictions>
	theme?: "light" | "dark"
}

const FileUpload = forwardRef(function FileUpload(props: FileUploadProps, _ref) {
	const id = props.id ? `dashboard-${props.id}` : "uppy-dashboard"
	const [uppy] = useState(() =>
		new Uppy<Meta, AwsBody>({ id, restrictions: props.restrictions }).use(AwsS3Multipart)
	)
	useEffect(() => {
		const handler = () => {
			const uploadedFiles = uppy.getFiles()
			const formattedFiles = uploadedFiles.map((file) => {
				const publicUploadUrl =
					typeof file.meta.publicUploadUrl === "string"
						? file.meta.publicUploadUrl
						: undefined

				return {
					id: file.id,
					fileName: file.name,
					fileSource: file.source,
					fileType: file.type,
					fileSize: file.size,
					fileMeta: file.meta,
					fileUploadUrl: publicUploadUrl ?? file.response?.uploadURL,
					filePreview: file.preview,
				}
			}) as FormattedFile[]
			props.onUpdateFiles(formattedFiles)
		}
		uppy.on("complete", handler)

		// Make sure we only have one listener at a time
		return () => {
			uppy.off("complete", handler)
		}
	}, [props.onUpdateFiles, uppy.getFiles, uppy.off, uppy.on])

	useEffect(() => {
		uppy.getPlugin<AwsS3Multipart<Meta, AwsBody>>(pluginName)?.setOptions({
			// TODO: maybe use more specific types for Meta and Body
			getUploadParameters: async (file) => {
				if (!file || !file.type) {
					throw new Error("Could not read file.")
				}

				if (!file.name) {
					throw new Error("File name is required")
				}

				const uploadResponse = await props.upload(file.name)

				if (typeof uploadResponse === "object" && "error" in uploadResponse) {
					throw new Error(uploadResponse.error)
				}

				const uploadTarget =
					typeof uploadResponse === "string"
						? { signedUrl: uploadResponse, publicUrl: undefined }
						: uploadResponse

				if (uploadTarget.publicUrl) {
					uppy.setFileMeta(file.id, {
						publicUploadUrl: uploadTarget.publicUrl,
					})
				}

				return {
					method: "PUT",
					url: uploadTarget.signedUrl,
					headers: {
						"content-type": file.type,
					},
				}
			},
		})
	}, [props.upload, uppy.getPlugin, uppy.setFileMeta])

	return (
		<Dashboard
			uppy={uppy}
			disabled={props.disabled}
			theme={props.theme}
			id={id}
			width="100%"
			height="250px"
		/>
	)
})

export { FileUpload }
