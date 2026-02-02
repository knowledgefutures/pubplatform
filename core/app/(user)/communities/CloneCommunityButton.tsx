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
import { Input } from "ui/input"
import { Clipboard, Download, Layers, Loader2 } from "ui/icon"
import { Label } from "ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/tabs"
import { toast } from "ui/use-toast"

import { didSucceed, useServerAction } from "~/lib/serverActions"
import { exportCommunityCloneAction, importCommunityCloneAction } from "./cloneActions"
import { JsonEditor } from "ui/monaco"

type CloneCommunityButtonProps = {
	communityId: string
	communityName: string
	communitySlug: string
}

export const CloneCommunityButton = ({
	communityId,
	communityName,
	communitySlug,
}: CloneCommunityButtonProps) => {
	const [open, setOpen] = React.useState(false)
	const [activeTab, setActiveTab] = React.useState<"export" | "import">("export")
	const [cloneData, setCloneData] = React.useState<string>("")
	const [isLoading, setIsLoading] = React.useState(false)

	// import state
	const [importJson, setImportJson] = React.useState<string>("")
	const [newSlug, setNewSlug] = React.useState<string>("")
	const [newName, setNewName] = React.useState<string>("")
	const [isImporting, setIsImporting] = React.useState(false)

	const runExport = useServerAction(exportCommunityCloneAction)
	const runImport = useServerAction(importCommunityCloneAction)

	const handleExport = async () => {
		setIsLoading(true)
		setOpen(true)
		setActiveTab("export")

		const result = await runExport({ communityId: communityId as CommunitiesId })
		if (didSucceed(result) && result.clone) {
			setCloneData(result.clone)
			// pre-fill import fields
			try {
				const parsed = JSON.parse(result.clone)
				setNewSlug(`${parsed.sourceCommunity.slug}-clone`)
				setNewName(`${parsed.sourceCommunity.name} (Clone)`)
			} catch {
				setNewSlug(`${communitySlug}-clone`)
				setNewName(`${communityName} (Clone)`)
			}
		} else {
			setOpen(false)
		}
		setIsLoading(false)
	}

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(cloneData)
			toast.success("Clone data copied to clipboard")
		} catch {
			toast.error("Failed to copy to clipboard")
		}
	}

	const handleDownload = () => {
		const blob = new Blob([cloneData], { type: "application/json" })
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		a.download = `${communitySlug}-clone.json`
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(url)
		toast.success("Clone data downloaded")
	}

	const handleImport = async () => {
		if (!newSlug.trim()) {
			toast.error("Please enter a slug for the new community")
			return
		}

		setIsImporting(true)
		const result = await runImport({
			cloneJson: cloneData || importJson,
			newSlug: newSlug.trim(),
			newName: newName.trim() || undefined,
		})

		if (didSucceed(result) && result.communitySlug) {
			toast.success(`Community "${newName || newSlug}" created successfully`)
			setOpen(false)
			// navigate to new community
			window.location.href = `/c/${result.communitySlug}`
		}
		setIsImporting(false)
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
				<Layers size={14} />
				Clone Community
			</DropdownMenuItem>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-4xl">
					<DialogTitle>Clone Community</DialogTitle>
					<DialogDescription>
						Create a full copy of "{communityName}" including all pubs, automations, and
						configurations. This is useful for debugging or creating test environments.
					</DialogDescription>

					<Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "export" | "import")}>
						<TabsList>
							<TabsTrigger value="export">Export</TabsTrigger>
							<TabsTrigger value="import">Import</TabsTrigger>
						</TabsList>

						<TabsContent value="export" className="space-y-4">
							{isLoading ? (
								<div className="flex h-[300px] items-center justify-center">
									<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
								</div>
							) : (
								<>
									<div className="h-[300px] rounded-md border">
										<JsonEditor
											value={cloneData}
											onChange={setCloneData}
											height="300px"
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
										</div>
										<Button onClick={() => setActiveTab("import")}>
											Import as New Community
										</Button>
									</div>
								</>
							)}
						</TabsContent>

						<TabsContent value="import" className="space-y-4">
							<div className="grid gap-4">
								<div className="grid gap-2">
									<Label htmlFor="new-slug">New Community Slug</Label>
									<Input
										id="new-slug"
										value={newSlug}
										onChange={(e) => setNewSlug(e.target.value)}
										placeholder="my-community-clone"
									/>
									<p className="text-xs text-muted-foreground">
										Must be unique. Use lowercase letters, numbers, and hyphens only.
									</p>
								</div>

								<div className="grid gap-2">
									<Label htmlFor="new-name">New Community Name (optional)</Label>
									<Input
										id="new-name"
										value={newName}
										onChange={(e) => setNewName(e.target.value)}
										placeholder="My Community (Clone)"
									/>
								</div>

								{!cloneData && (
									<div className="grid gap-2">
										<Label>Clone Data (paste JSON if importing from file)</Label>
										<div className="h-[200px] rounded-md border">
											<JsonEditor
												value={importJson}
												onChange={setImportJson}
												height="200px"
											/>
										</div>
									</div>
								)}
							</div>

							<div className="flex justify-end gap-2">
								<Button variant="outline" onClick={() => setOpen(false)}>
									Cancel
								</Button>
								<Button onClick={handleImport} disabled={isImporting}>
									{isImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
									Create Clone
								</Button>
							</div>
						</TabsContent>
					</Tabs>
				</DialogContent>
			</Dialog>
		</>
	)
}
