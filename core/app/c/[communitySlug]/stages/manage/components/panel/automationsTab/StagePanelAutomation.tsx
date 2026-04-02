"use client"

import type {
	ActionRunStatus,
	ActionRuns,
	AutomationRuns,
	CommunitiesId,
	StagesId,
} from "db/public"
import type { FullAutomation } from "db/types"

import { useCallback } from "react"
import { AlertTriangle, Copy, Pencil, Trash2 } from "lucide-react"

import { DynamicIcon, type IconConfig } from "ui/dynamic-icon"
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "ui/item"
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip"
import { toast } from "ui/use-toast"

import { getTriggerByName } from "~/actions/_lib/triggers"
import { EllipsisMenu, EllipsisMenuButton } from "~/app/components/EllipsisMenu"
import { didSucceed, useServerAction } from "~/lib/serverActions"
import { deleteAutomation, duplicateAutomation } from "../../../actions"

type ValidationIssue = {
	actionName: string
	field: string
	message: string
	severity: "error" | "warning"
}

type Props = {
	stageId: StagesId
	communityId: CommunitiesId
	automation: FullAutomation
	validationIssues?: ValidationIssue[]
}

import { useEffect, useState } from "react"
import Link from "next/link"
import { isAfter, parseISO } from "date-fns"

import { HoverCard, HoverCardContent, HoverCardTrigger } from "ui/hover-card"
import { cn } from "utils"

import { AutomationRunResult } from "~/app/components/AutomationUI/AutomationRunResult"
import { useCommunity } from "~/app/components/providers/CommunityProvider"
import { constructAutomationRunPage } from "~/lib/links"
import { useAutomationId } from "../usePanelQueryParams"

export const UpdateCircle = (
	props: Omit<AutomationRuns, "status"> & {
		actionRuns: ActionRuns[]
		status: ActionRunStatus | "partial"
		stale: boolean
		setStale: (stale: boolean) => void
		setInitTime: (initTime: Date) => void
	}
) => {
	const status = props.status

	return (
		<HoverCard>
			<HoverCardTrigger
				onMouseOver={() => {
					if (props.stale === true) {
						props.setStale(false)
						props.setInitTime(new Date())
					}
				}}
			>
				<div
					data-testid={`automation-run-${props.id}-update-circle`}
					data-status={status}
					className={cn(
						"relative m-1 h-2 w-2 rounded-full transition-colors duration-200",
						{
							"bg-green-500": status === "success",
							"bg-destructive": status === "failure",
							"bg-yellow-500": status === "scheduled",
							"bg-muted":
								status !== "success" &&
								status !== "failure" &&
								status !== "scheduled",
						}
					)}
				>
					{props.stale && (
						<span
							data-testid={`automation-run-${props.id}-update-circle-stale`}
							className="-top-0.5 absolute right-0 block h-1 w-1 animate-pulse rounded-full bg-blue-800"
						></span>
					)}
				</div>
			</HoverCardTrigger>
			<HoverCardContent className="max-h-[32rem] w-96 overflow-auto p-3">
				<div className="space-y-2">
					<div className="flex items-center gap-2">
						<div
							className={cn("h-3 w-3 rounded-full", {
								"bg-green-500": status === "success",
								"bg-red-500": status === "failure",
								"bg-yellow-500": status === "scheduled",
								"bg-gray-500":
									status !== "success" &&
									status !== "failure" &&
									status !== "scheduled",
							})}
						/>
						<span className="font-medium capitalize">{status}</span>
					</div>

					<div className="text-gray-600 text-xs">
						{props.createdAt && (
							<div className="flex items-center justify-between">
								<span>Timestamp: </span>
								<span
									className="font-mono"
									data-testid={`automation-run-${props.id}-update-circle-timestamp`}
								>
									{props.createdAt.toLocaleString()}
								</span>
							</div>
						)}

						{props.actionRuns.at(-1)?.pubId && (
							<div className="flex items-center justify-between">
								<span>ID:</span>
								<span className="truncate font-mono">
									{props.actionRuns.at(-1)?.pubId}
								</span>
							</div>
						)}
					</div>

					{props.actionRuns.length > 0 && (
						<div className="pt-1">
							<div className="font-medium text-xs">Result:</div>
							<div
								className="mt-1"
								data-testid={`automation-run-${props.id}-update-circle-result`}
							>
								<AutomationRunResult
									automationRun={
										props as AutomationRuns & { actionRuns: ActionRuns[] }
									}
									showOverallStatus={false}
								/>
							</div>
						</div>
					)}
				</div>
			</HoverCardContent>
		</HoverCard>
	)
}

export const StagePanelAutomation = (props: Props) => {
	const [initTime, setInitTime] = useState(new Date())
	const [isStale, setIsStale] = useState(false)
	const community = useCommunity()
	useEffect(() => {
		if (!props.automation.lastAutomationRun) return

		// parse both as UTC to ensure proper comparison regardless of local timezone
		const lastRunTime = parseISO(`${props.automation.lastAutomationRun.createdAt.toString()}Z`)

		// compare the dates using date-fns isAfter helper
		if (isAfter(lastRunTime, initTime)) {
			setIsStale(true)
		}
	}, [props.automation.lastAutomationRun])

	const { automation } = props

	const { setAutomationId: setEditingAutomationId } = useAutomationId()

	const onEditClick = useCallback(() => {
		setEditingAutomationId(automation.id)
	}, [automation.id, setEditingAutomationId])

	const runDeleteAutomation = useServerAction(deleteAutomation)
	const onDeleteClick = useCallback(async () => {
		const res = await runDeleteAutomation(automation.id, props.stageId)
		if (didSucceed(res)) {
			toast("Automation deleted")
		}
	}, [props.stageId, runDeleteAutomation, automation.id])

	const runDuplicateAutomation = useServerAction(duplicateAutomation)
	const onDuplicateClick = useCallback(async () => {
		const res = await runDuplicateAutomation(automation.id, props.stageId)
		if (didSucceed(res)) {
			toast("Automation duplicated")
		}
	}, [props.stageId, runDuplicateAutomation, automation.id])

	const triggerIcons = automation.triggers.map((trigger) => getTriggerByName(trigger.event))

	return (
		<Item variant="outline" size="sm" className="relative">
			<ItemMedia>
				<DynamicIcon icon={automation.icon as IconConfig} size={16} />
			</ItemMedia>
			<ItemContent className="flex-row items-center justify-between truncate">
				<ItemTitle title={automation.name} className="line-clamp-1 truncate font-normal">
					<Link
						href={`/c/${community.slug}/stages/manage?editingStageId=${props.stageId}&tab=automations&automationId=${automation.id}`}
						onClick={(e) => {
							// slightly nicer behavior, does not trigger server reload
							e.preventDefault()
							onEditClick()
						}}
					>
						{automation.name}
					</Link>
				</ItemTitle>
			</ItemContent>

			<ItemActions>
				{props.validationIssues && props.validationIssues.length > 0 && (
					<Tooltip>
						<TooltipTrigger asChild>
							<AlertTriangle
								size={14}
								className={cn(
									props.validationIssues.some((i) => i.severity === "error")
										? "text-destructive"
										: "text-amber-500"
								)}
							/>
						</TooltipTrigger>
						<TooltipContent className="max-w-xs">
							<p className="font-medium text-xs">Config issues:</p>
							<ul className="mt-1 space-y-0.5 text-xs">
								{props.validationIssues.map((issue, idx) => (
									<li key={idx}>
										{issue.field}: {issue.message}
									</li>
								))}
							</ul>
						</TooltipContent>
					</Tooltip>
				)}
				<div className="flex items-center gap-2 rounded-full">
					{triggerIcons.map((icon) => (
						<icon.display.icon key={icon.event} className="size-2.5 text-xs" />
					))}
				</div>
				<div className="absolute top-0.5 left-0.5">
					{props.automation.lastAutomationRun && (
						<UpdateCircle
							{...props.automation.lastAutomationRun}
							stale={isStale}
							setStale={setIsStale}
							setInitTime={setInitTime}
						/>
					)}
				</div>
				<EllipsisMenu>
					<EllipsisMenuButton icon={Pencil} onClick={onEditClick}>
						Edit
					</EllipsisMenuButton>
					<EllipsisMenuButton icon={Copy} onClick={onDuplicateClick}>
						Duplicate
					</EllipsisMenuButton>
					<EllipsisMenuButton asChild>
						<Link
							href={constructAutomationRunPage({
								automationId: automation.id,
								communitySlug: community.slug,
							})}
						>
							View run log
						</Link>
					</EllipsisMenuButton>
					<EllipsisMenuButton variant="destructive" icon={Trash2} onClick={onDeleteClick}>
						Delete
					</EllipsisMenuButton>
				</EllipsisMenu>
			</ItemActions>
		</Item>
	)
}
