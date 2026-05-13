import type { FileUploadProps } from "ui/customRenderers/fileUpload/fileUpload"

import { useState } from "react"
import dynamic from "next/dynamic"
import { ImagePlus, XIcon } from "lucide-react"
import { useTheme } from "next-themes"

import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar"
import { Button } from "ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover"
import { Skeleton } from "ui/skeleton"

const FileUpload = dynamic(
	async () => import("ui/customRenderers/fileUpload/fileUpload").then((mod) => mod.FileUpload),
	{
		ssr: false,
		loading: () => <Skeleton className="h-[182px] w-full" />,
	}
)

export const AvatarEditor = ({
	initials,
	avatar,
	onEdit,
	upload,
	allowedFileTypes,
	showDeleteButton = true,
	label,
}: {
	initials: string
	avatar: string | null
	onEdit: (avatar: string | null) => void
	upload: FileUploadProps["upload"]
	allowedFileTypes?: string[]
	showDeleteButton?: boolean
	label?: string
}) => {
	const [popoverOpen, setPopoverOpen] = useState(false)
	const { resolvedTheme } = useTheme()

	const fileUpload = (
		<FileUpload
			theme={resolvedTheme as "light" | "dark"}
			upload={upload}
			restrictions={{
				allowedFileTypes: allowedFileTypes ?? [
					"image/jpeg",
					"image/png",
					"image/webp",
					"image/avif",
				],
				maxNumberOfFiles: 1,
			}}
			onUpdateFiles={(event) => {
				const avatarUrl = event[0]?.fileUploadUrl
				if (!avatarUrl) return
				onEdit(avatarUrl)
				setPopoverOpen(false)
			}}
			id={label ? `${label}-avatar` : "avatar"}
		/>
	)

	const avatarImage = avatar ? (
		<img src={avatar} alt={label ?? "Avatar"} className="h-full w-full object-cover" />
	) : (
		<Avatar className="h-full w-full">
			<AvatarFallback className="text-lg">{initials}</AvatarFallback>
		</Avatar>
	)

	const hoverOverlay = (
		<div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity hover:opacity-100">
			<ImagePlus className="h-6 w-6 text-white" />
		</div>
	)

	const avatarButton = label ? (
		<Button
			type="button"
			variant="outline"
			className="relative h-20 w-20 overflow-hidden rounded-full p-0"
		>
			{avatarImage}
			{hoverOverlay}
		</Button>
	) : (
		<Avatar className="group/avatar relative h-20 w-20">
			<AvatarImage src={avatar ?? undefined} />
			<AvatarFallback>{initials}</AvatarFallback>
			<Button
				type="button"
				variant="ghost"
				className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 h-full w-full p-0"
			>
				{hoverOverlay}
			</Button>
		</Avatar>
	)

	return (
		<div className="group relative">
			<div className={label ? "flex items-center gap-4" : undefined}>
				<Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
					<PopoverTrigger asChild>{avatarButton}</PopoverTrigger>
					<PopoverContent className="p-0">{fileUpload}</PopoverContent>
				</Popover>
				{label && (
					<div className="flex flex-col gap-1">
						<p className="font-medium text-sm">{label}</p>
						<p className="text-muted-foreground text-xs">Click to upload (optional)</p>
					</div>
				)}
			</div>
			{showDeleteButton && avatar && (
				<Button
					type="button"
					variant="ghost"
					className="-top-2 absolute left-20 z-10 hidden h-8 w-8 p-0 group-hover:flex"
					aria-label="Delete avatar"
					onClick={() => {
						onEdit(null)
					}}
				>
					<XIcon className="h-4 w-4 text-destructive" />
				</Button>
			)}
		</div>
	)
}
