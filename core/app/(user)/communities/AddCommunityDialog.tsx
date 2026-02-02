"use client"

import React from "react"

import { Button } from "ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "ui/dialog"
import { CurlyBraces, ListPlus, Loader2 } from "ui/icon"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip"
import { toast } from "ui/use-toast"

import { EXAMPLE_TEMPLATE } from "~/lib/server/communityTemplate/types"
import { didSucceed, useServerAction } from "~/lib/serverActions"
import { AddCommunityForm } from "./AddCommunityForm"
import { TemplateEditor, useTemplateEditor } from "./TemplateEditor"
import { createCommunityFromTemplateAction } from "./templateActions"

type AddCommunityProps = {
	initialTemplate?: string
}

export const AddCommunity = ({ initialTemplate }: AddCommunityProps) => {
	const [open, setOpen] = React.useState(false)
	const [activeTab, setActiveTab] = React.useState<string>("basic")

	// reset tab when dialog closes
	React.useEffect(() => {
		if (!open) {
			setActiveTab("basic")
		}
	}, [open])

	// if initial template is provided, open in template mode
	React.useEffect(() => {
		if (initialTemplate) {
			setActiveTab("template")
			setOpen(true)
		}
	}, [initialTemplate])

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipContent>Create a new community</TooltipContent>
				<TooltipTrigger asChild>
					<DialogTrigger asChild>
						<Button variant="outline" className="flex items-center gap-x-2">
							<ListPlus size="16" /> Create Community
						</Button>
					</DialogTrigger>
				</TooltipTrigger>
			</Tooltip>

			<DialogContent className="max-w-2xl">
				<DialogTitle>Create Community</DialogTitle>
				<DialogDescription>
					Create a new community from scratch or use a template.
				</DialogDescription>

				<Tabs value={activeTab} onValueChange={setActiveTab}>
					<TabsList className="grid w-full grid-cols-2">
						<TabsTrigger value="basic">Basic</TabsTrigger>
						<TabsTrigger value="template" className="gap-1.5">
							<CurlyBraces size={14} />
							From Template
						</TabsTrigger>
					</TabsList>

					<TabsContent value="basic" className="mt-4">
						<AddCommunityForm setOpen={setOpen} />
					</TabsContent>

					<TabsContent value="template" className="mt-4">
						<TemplateTabContent setOpen={setOpen} initialTemplate={initialTemplate} />
					</TabsContent>
				</Tabs>
			</DialogContent>
		</Dialog>
	)
}

type TemplateTabContentProps = {
	setOpen: (open: boolean) => void
	initialTemplate?: string
}

const TemplateTabContent = ({ setOpen, initialTemplate }: TemplateTabContentProps) => {
	const { value, setValue, isValid } = useTemplateEditor(
		initialTemplate ?? JSON.stringify(EXAMPLE_TEMPLATE, null, 2)
	)
	const [isSubmitting, setIsSubmitting] = React.useState(false)
	const runCreateFromTemplate = useServerAction(createCommunityFromTemplateAction)

	const handleSubmit = async () => {
		if (!isValid) return

		setIsSubmitting(true)
		try {
			const result = await runCreateFromTemplate({ templateJson: value })
			if (didSucceed(result)) {
				toast.success("Community created successfully")
				setOpen(false)
			}
		} finally {
			setIsSubmitting(false)
		}
	}

	const loadExample = () => {
		setValue(JSON.stringify(EXAMPLE_TEMPLATE, null, 2))
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<p className="text-muted-foreground text-sm">
					Paste or edit a community template JSON below.
				</p>
				<Button variant="ghost" size="sm" onClick={loadExample}>
					Load Example
				</Button>
			</div>

			<TemplateEditor
				value={value}
				onChange={setValue}
				height="300px"
				showCopyButton={true}
				showValidationSummary={true}
			/>

			<div className="flex justify-end gap-2">
				<Button variant="outline" size="sm" onClick={() => setOpen(false)}>
					Cancel
				</Button>
				<Button size="sm" onClick={handleSubmit} disabled={!isValid || isSubmitting}>
					{isSubmitting ? (
						<>
							<Loader2 className="animate-spin" size={16} />
							Creating...
						</>
					) : (
						"Create Community"
					)}
				</Button>
			</div>
		</div>
	)
}
