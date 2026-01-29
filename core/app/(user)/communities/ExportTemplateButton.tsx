"use client"

import type { CommunitiesId } from "db/public"

import * as React from "react"

import { Button } from "ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "ui/dialog"
import { DropdownMenuItem } from "ui/dropdown-menu"
import { Clipboard, CurlyBraces, Download, Loader2 } from "ui/icon"
import { toast } from "ui/use-toast"

import { didSucceed, useServerAction } from "~/lib/serverActions"
import { exportCommunityTemplateAction } from "./templateActions"
import { TemplateEditor } from "./TemplateEditor"

type ExportTemplateButtonProps = {
	communityId: string
	communityName: string
	onCreateCopy?: (template: string) => void
}

export const ExportTemplateButton = ({
	communityId,
	communityName,
	onCreateCopy,
}: ExportTemplateButtonProps) => {
	const [open, setOpen] = React.useState(false)
	const [template, setTemplate] = React.useState<string>("")
	const [isLoading, setIsLoading] = React.useState(false)
	const runExport = useServerAction(exportCommunityTemplateAction)

	const handleExport = async () => {
		setIsLoading(true)
		setOpen(true)

		const result = await runExport({ communityId: communityId as CommunitiesId })
		if (didSucceed(result) && result.template) {
			setTemplate(result.template)
		} else {
			setOpen(false)
		}
		setIsLoading(false)
	}

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(template)
			toast.success("Template copied to clipboard")
		} catch {
			toast.error("Failed to copy to clipboard")
		}
	}

	const handleDownload = () => {
		const blob = new Blob([template], { type: "application/json" })
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		a.download = `${communityName.toLowerCase().replace(/\s+/g, "-")}-template.json`
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(url)
		toast.success("Template downloaded")
	}

	const handleCreateCopy = () => {
		if (onCreateCopy) {
			// modify the template to have a new slug
			try {
				const parsed = JSON.parse(template)
				parsed.community.slug = `${parsed.community.slug}-copy`
				parsed.community.name = `${parsed.community.name} (Copy)`
				onCreateCopy(JSON.stringify(parsed, null, 2))
				setOpen(false)
			} catch {
				onCreateCopy(template)
				setOpen(false)
			}
		}
	}

	return (
		<>
			<DropdownMenuItem
				onClick={(e) => {
					e.preventDefault()
					handleExport()
				}}
				className="gap-2"
			>
				<CurlyBraces size={14} />
				Export Template
			</DropdownMenuItem>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-3xl">
					<DialogTitle>Export Community Template</DialogTitle>
					<DialogDescription>
						This template contains the structure of "{communityName}" and can be used to
						create a new community with the same configuration.
					</DialogDescription>

					{isLoading ? (
						<div className="flex h-[300px] items-center justify-center">
							<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
						</div>
					) : (
						<>
							<TemplateEditor
								value={template}
								onChange={setTemplate}
								readOnly={false}
								height="350px"
								showCopyButton={false}
								showValidationSummary={false}
							/>

							<div className="flex justify-between">
								<div className="flex gap-2">
								<Button variant="outline" size="sm" onClick={handleCopy}>
									<Clipboard size={14} />
									Copy
								</Button>
									<Button variant="outline" size="sm" onClick={handleDownload}>
										<Download size={14} />
										Download
									</Button>
								</div>
								<div className="flex gap-2">
									<Button variant="outline" onClick={() => setOpen(false)}>
										Close
									</Button>
									{onCreateCopy && (
										<Button onClick={handleCreateCopy}>
											Create Copy
										</Button>
									)}
								</div>
							</div>
						</>
					)}
				</DialogContent>
			</Dialog>
		</>
	)
}
