"use client"

import React from "react"

import { Button } from "ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "ui/dialog"
import { CurlyBraces, ListPlus } from "ui/icon"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip"

import { AddCommunityForm } from "./AddCommunityForm"
import { BlueprintImportWizard } from "./BlueprintImportWizard"

type AddCommunityProps = {
	initialTemplate?: string
}

export const AddCommunity = ({ initialTemplate }: AddCommunityProps) => {
	const [open, setOpen] = React.useState(false)
	const [activeTab, setActiveTab] = React.useState<string>("basic")

	React.useEffect(() => {
		if (!open) {
			setActiveTab("basic")
		}
	}, [open])

	React.useEffect(() => {
		if (initialTemplate) {
			setActiveTab("blueprint")
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
					Create a new community from scratch or import from a blueprint.
				</DialogDescription>

				<Tabs value={activeTab} onValueChange={setActiveTab}>
					<TabsList className="grid w-full grid-cols-2">
						<TabsTrigger value="basic">Basic</TabsTrigger>
						<TabsTrigger value="blueprint" className="gap-1.5">
							<CurlyBraces size={14} />
							From Blueprint
						</TabsTrigger>
					</TabsList>

					<TabsContent value="basic" className="mt-4">
						<AddCommunityForm setOpen={setOpen} />
					</TabsContent>

					<TabsContent value="blueprint" className="mt-4">
						<BlueprintImportWizard
							onComplete={() => setOpen(false)}
							initialBlueprint={initialTemplate}
						/>
					</TabsContent>
				</Tabs>
			</DialogContent>
		</Dialog>
	)
}
