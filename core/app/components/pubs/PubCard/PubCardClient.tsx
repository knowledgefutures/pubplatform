"use client"

import type { ProcessedPub } from "contracts"

import { useCallback } from "react"
import Link from "next/link"
import { cva } from "class-variance-authority"

import { Card, CardFooter, CardTitle } from "ui/card"
import { Checkbox } from "ui/checkbox"
import { Calendar, History } from "ui/icon"
import { cn } from "utils"

import { BasicMoveButton } from "~/app/c/[communitySlug]/stages/components/BasicMoveButton"
import { formatDateAsMonthDayYear, formatDateAsPossiblyDistance } from "~/lib/dates"
import { getPubTitle } from "~/lib/pubs"
import { useCommunity } from "../../providers/CommunityProvider"

export type PubCardClientPub = Omit<
	ProcessedPub<{ withPubType: true; withStage?: boolean }>,
	"depth" | "communityId" | "values"
>

import type { PubsId } from "db/public"
import type { Json } from "db/types"

import { PubTypeLabel } from "./PubTypeLabel"

export type PubCardClientProps = {
	pub: PubCardClientPub
	selected?: boolean
	onSelect?: (pub: PubCardClientPub, selected: boolean) => void
	disabled?: boolean
	showCheckbox?: boolean
	className?: string
	showTime?: boolean
	/* should the whole card be a link?*/
	bigLink?: boolean
	children?: React.ReactNode
}

export const PubCardClient = ({
	pub,
	selected = false,
	onSelect,
	disabled = false,
	showCheckbox = true,
	showTime = true,
	className,
	bigLink = false,
	children,
}: PubCardClientProps) => {
	const matchingValues = pub.matchingValues?.filter((match) => !match.isTitle)

	const handleCheckboxChange = useCallback(
		(checked: boolean) => {
			if (onSelect && !disabled) {
				onSelect(pub, checked)
			}
		},
		[onSelect, disabled, pub]
	)

	return (
		<PubCard
			className={cn(
				!disabled && onSelect && "cursor-pointer hover:border-gray-300",
				className
			)}
			variant={selected ? "selected" : disabled ? "disabled" : "default"}
			dataTestId={`pub-card-${pub.id}`}
		>
			<PubCardContent>
				<PubCardHeader className="pr-4">
					<PubTypeLabel pubType={pub.pubType} canFilter={false} />

					{pub.stage && <BasicMoveButton name={pub.stage.name} withDropdown={false} />}

					{showCheckbox && (
						<PubCardCheckbox
							className="absolute top-2 right-2"
							selected={selected}
							disabled={disabled}
							handleCheckboxChange={handleCheckboxChange}
						/>
					)}
				</PubCardHeader>
				<PubCardTitle pubId={pub.id} bigLink={bigLink}>
					<div
						className="[&_mark]:bg-yellow-300"
						dangerouslySetInnerHTML={{ __html: getPubTitle(pub) }}
					/>
				</PubCardTitle>
				{matchingValues && matchingValues.length !== 0 && (
					<PubCardMatchingValues matchingValues={matchingValues} />
				)}
				{children}

				{showTime && (
					<PubCardFooter>
						<PubCardCreatedAt createdAt={pub.createdAt} />
						<PubCardUpdatedAt updatedAt={pub.updatedAt} />
					</PubCardFooter>
				)}
			</PubCardContent>
		</PubCard>
	)
}

const pubCardVariants = cva(
	"group relative flex flex-row items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 transition-colors",
	{
		variants: {
			variant: {
				default: "",
				selected:
					"border border-blue-500! bg-blue-50 dark:border-blue-500/50! dark:bg-card",
				disabled: "cursor-not-allowed opacity-50",
				hover: "cursor-pointer hover:border-gray-300",
			},
		},
	}
)

export const PubCard = ({
	className,
	children,
	dataTestId,
	variant = "default",
}: {
	className?: string
	children?: React.ReactNode
	dataTestId?: string
	variant?: "default" | "selected" | "disabled" | "hover"
}) => {
	return (
		<Card
			data-slot="pub-card"
			className={pubCardVariants({ variant, className })}
			data-testid={dataTestId}
		>
			{children}
		</Card>
	)
}

export const PubCardContent = ({
	className,
	children,
}: {
	className?: string
	children?: React.ReactNode
}) => {
	return (
		<div
			data-slot="pub-card-content"
			className={cn("flex w-full min-w-0 flex-1 flex-col space-y-[8px]", className)}
		>
			{children}
		</div>
	)
}

export const PubCardCheckbox = ({
	selected,
	disabled,
	handleCheckboxChange,
	className,
}: {
	selected: boolean
	disabled: boolean
	handleCheckboxChange: (checked: boolean) => void
	className?: string
}) => {
	return (
		<Checkbox
			aria-label="Select pub"
			checked={selected}
			onCheckedChange={handleCheckboxChange}
			disabled={disabled}
			className={cn("z-10 h-5 w-5 shrink-0 border-neutral-500", className)}
		/>
	)
}

export const PubCardHeader = ({
	children,
	className,
}: {
	children?: React.ReactNode
	className?: string
}) => {
	return (
		<div
			data-slot="pub-card-header"
			className={cn("z-10 flex flex-row gap-2 overflow-x-auto p-0 leading-4", className)}
		>
			{children}
		</div>
	)
}

export const PubCardFooter = ({
	className,
	children,
}: {
	className?: string
	children?: React.ReactNode
}) => {
	return (
		<CardFooter
			data-slot="pub-card-footer"
			className={cn("flex gap-2 p-0 text-muted-foreground", className)}
		>
			{children}
		</CardFooter>
	)
}

export const PubCardCreatedAt = ({ createdAt }: { createdAt: string | Date }) => {
	return (
		<div className="flex gap-1" title="Created at" data-slot="pub-card-created-at">
			<Calendar size="16px" strokeWidth="1px" className="text-muted-foreground" />
			<time
				suppressHydrationWarning
				className="text-xs"
				dateTime={new Date(createdAt).toISOString()}
				title={new Date(createdAt).toLocaleString()}
			>
				{formatDateAsMonthDayYear(new Date(createdAt))}
			</time>
		</div>
	)
}

export const PubCardUpdatedAt = ({
	updatedAt,
	className,
}: {
	updatedAt: string | Date
	className?: string
}) => {
	return (
		<div
			className={cn("flex gap-1", className)}
			title="Updated at"
			data-slot="pub-card-updated-at"
		>
			<History size="16px" strokeWidth="1px" className="text-muted-foreground" />
			<time
				suppressHydrationWarning
				className="text-xs"
				dateTime={new Date(updatedAt).toISOString()}
				title={new Date(updatedAt).toLocaleString()}
			>
				{formatDateAsPossiblyDistance(new Date(updatedAt))}
			</time>
		</div>
	)
}

export const PubCardTitle = ({
	className,
	children,
	pubId,
	bigLink = false,
}: {
	className?: string
	children?: React.ReactNode
	pubId: PubsId
	bigLink?: boolean
}) => {
	const community = useCommunity()
	return (
		<CardTitle
			data-slot="pub-card-title"
			className={cn("truncate py-0.5 font-medium text-sm", className)}
		>
			<h3 className="min-w-0 truncate">
				<Link
					data-slot="pub-card-title-link"
					href={`/c/${community.slug}/pubs/${pubId}`}
					className={cn(
						"hover:underline",
						"focus-within:underline",
						bigLink &&
							"after:absolute after:top-0 after:right-0 after:bottom-0 after:left-0 after:z-0 after:block after:content-['']"
					)}
				>
					{children}
				</Link>
			</h3>
		</CardTitle>
	)
}
type MatchingValue = {
	slug: string
	name: string
	value: Json
	isTitle: boolean
	highlights: string
}

export const PubCardMatchingValues = ({
	matchingValues,
	className,
}: {
	matchingValues: MatchingValue[]
	className?: string
}) => {
	return (
		<div
			className={cn(
				"grid grid-cols-[minmax(0rem,auto)_minmax(0,1fr)] gap-1 text-muted-foreground text-xs",
				"[&_mark]:bg-yellow-200",
				className
			)}
		>
			{matchingValues.map((match, idx) => (
				<>
					<span key={`${idx}-${match.slug}`} className="font-medium">
						{match.name}:
					</span>
					<span
						key={`${idx}-${match.slug}-highlights`}
						dangerouslySetInnerHTML={{
							__html: match.highlights,
						}}
						className="font-light text-muted-foreground"
					/>
				</>
			))}
		</div>
	)
}
