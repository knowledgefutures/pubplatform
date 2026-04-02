"use client"

import type { CommunitiesId } from "db/public"

import * as React from "react"

import { Button } from "ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "ui/dialog"
import { DropdownMenuItem } from "ui/dropdown-menu"
import { AlertCircle, Clipboard, CurlyBraces, Download, Loader2 } from "ui/icon"
import { JsonEditor } from "ui/monaco"
import { toast } from "ui/use-toast"

import { didSucceed, useServerAction } from "~/lib/serverActions"
import { exportBlueprintAction, exportBlueprintAsSeedAction } from "./blueprintActions"

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
	const [blueprint, setBlueprint] = React.useState<string>("")
	const [exportWarnings, setExportWarnings] = React.useState<string[]>([])
	const [isLoading, setIsLoading] = React.useState(false)
	const [isCopyingSeed, setIsCopyingSeed] = React.useState(false)
	const runExport = useServerAction(exportBlueprintAction)
	const runExportSeed = useServerAction(exportBlueprintAsSeedAction)

	const handleExport = async () => {
		setIsLoading(true)
		setOpen(true)

		const result = await runExport({ communityId: communityId as CommunitiesId })
		if (didSucceed(result) && result.blueprint) {
			setBlueprint(result.blueprint)
			setExportWarnings(result.warnings ?? [])
		} else {
			setOpen(false)
		}
		setIsLoading(false)
	}

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(blueprint)
			toast.success("Blueprint copied to clipboard")
		} catch {
			toast.error("Failed to copy to clipboard")
		}
	}

	const handleDownload = () => {
		const blob = new Blob([blueprint], { type: "application/json" })
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		a.download = `${communityName.toLowerCase().replace(/\s+/g, "-")}-blueprint.json`
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(url)
		toast.success("Blueprint downloaded")
	}

	const handleCreateCopy = () => {
		if (!onCreateCopy) return
		try {
			const parsed = JSON.parse(blueprint)
			parsed.community.slug = `${parsed.community.slug}-copy`
			parsed.community.name = `${parsed.community.name} (Copy)`
			onCreateCopy(JSON.stringify(parsed, null, 2))
			setOpen(false)
		} catch {
			onCreateCopy(blueprint)
			setOpen(false)
		}
	}

	return (
		<>
			<DropdownMenuItem
				onClick={(e) => {
					e.preventDefault()
					void handleExport()
				}}
				className="gap-2"
			>
				<CurlyBraces size={14} />
				Export Blueprint
			</DropdownMenuItem>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-3xl">
					<DialogTitle>Export Community Blueprint</DialogTitle>
					<DialogDescription>
						This blueprint contains the full structure of "{communityName}" and can be
						used to recreate the community on any PubPub instance.
					</DialogDescription>

					{isLoading ? (
						<div className="flex h-[300px] items-center justify-center">
							<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
						</div>
					) : (
						<>
							{exportWarnings.length > 0 && (
								<div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950">
									<AlertCircle
										size={16}
										className="mt-0.5 shrink-0 text-amber-600"
									/>
									<div>
										<span className="font-medium text-amber-800 dark:text-amber-200">
											{exportWarnings.length} warning
											{exportWarnings.length !== 1 ? "s" : ""}
										</span>
										<ul className="mt-1 list-inside list-disc text-amber-700 text-xs dark:text-amber-300">
											{exportWarnings.slice(0, 5).map((w, i) => (
												<li key={i}>{w}</li>
											))}
											{exportWarnings.length > 5 && (
												<li>...and {exportWarnings.length - 5} more</li>
											)}
										</ul>
									</div>
								</div>
							)}

							<div className="h-[350px] rounded-md border">
								<JsonEditor
									value={blueprint}
									onChange={setBlueprint}
									height="350px"
									readOnly
								/>
							</div>

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
									<Button
										variant="outline"
										size="sm"
										disabled={isCopyingSeed}
										onClick={async () => {
											setIsCopyingSeed(true)
											const result = await runExportSeed({
												communityId:
													communityId as CommunitiesId,
											})
											setIsCopyingSeed(false)
											if (
												didSucceed(result) &&
												result.seedTs
											) {
												await navigator.clipboard.writeText(
													result.seedTs
												)
												toast.success(
													"Seed TypeScript copied to clipboard"
												)
											}
										}}
									>
										{isCopyingSeed ? (
											<Loader2
												className="animate-spin"
												size={14}
											/>
										) : (
											<CurlyBraces size={14} />
										)}
										Copy as Seed
									</Button>
								</div>
								<div className="flex gap-2">
									<Button
										variant="outline"
										size="sm"
										onClick={() => setOpen(false)}
									>
										Close
									</Button>
									{onCreateCopy && (
										<Button size="sm" onClick={handleCreateCopy}>
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
