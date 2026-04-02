"use client"

import { useMemo } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { Button } from "ui/button"
import { Form, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "ui/form"
import { Loader2 } from "ui/icon"
import { Input } from "ui/input"
import { toast } from "ui/use-toast"

import { AvatarEditor } from "~/app/(user)/settings/AvatarEditor"
import { uploadTempAvatar } from "~/app/login/actions"
import { didSucceed, useServerAction } from "~/lib/serverActions"
import { createCommunity } from "./actions"

export const communityCreateFormSchema = z.object({
	name: z.string().min(1),
	slug: z.string().min(1),
	avatar: z.string().url().nullable().optional(),
})

type Props = {
	setOpen: (open: false) => void
}

export const AddCommunityForm = (props: Props) => {
	const runCreateCommunity = useServerAction(createCommunity)
	const runUpload = useServerAction(uploadTempAvatar)

	async function onSubmit(data: z.infer<typeof communityCreateFormSchema>) {
		const result = await runCreateCommunity({ ...data })
		if (didSucceed(result)) {
			props.setOpen(false)
			toast.success("Community created")
		}
	}
	const form = useForm<z.infer<typeof communityCreateFormSchema>>({
		resolver: zodResolver(communityCreateFormSchema),
		defaultValues: {
			name: "",
			slug: "",
			avatar: null,
		},
	})

	const signedUploadUrl = (fileName: string) => {
		return runUpload({ fileName })
	}

	const communityName = form.watch("name")

	const communityInitials = useMemo(() => {
		return (
			communityName
				.split(" ")
				.slice(0, 2)
				.map((word) => word[0])
				.join("")
				.toUpperCase() || "C"
		)
	}, [communityName])

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-y-4">
				<FormField
					control={form.control}
					name="name"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Name</FormLabel>
							<Input {...field} />
							<FormDescription>What is the name of your community</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="slug"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Slug</FormLabel>
							<Input {...field} />
							<FormDescription>
								Name the string you want your community to route to
							</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="avatar"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Avatar (optional)</FormLabel>
							<AvatarEditor
								initials={communityInitials}
								avatar={field.value ?? null}
								onEdit={field.onChange}
								upload={signedUploadUrl}
								label="Community Avatar"
								showDeleteButton={false}
							/>
							<FormMessage />
						</FormItem>
					)}
				/>
				<Button size="sm" type="submit" disabled={form.formState.isSubmitting}>
					{form.formState.isSubmitting ? (
						<Loader2 />
					) : (
						<div className="flex items-center gap-x-2">Create Community</div>
					)}
				</Button>
			</form>
		</Form>
	)
}
