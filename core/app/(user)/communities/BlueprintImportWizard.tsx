"use client"

import * as React from "react"

import { Button } from "ui/button"
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle, Download, Loader2 } from "ui/icon"
import { Input } from "ui/input"
import { Label } from "ui/label"
import { JsonEditor } from "ui/monaco"
import { toast } from "ui/use-toast"
import { cn } from "utils"

import { didSucceed, useServerAction } from "~/lib/serverActions"
import { analyzeBlueprintAction, importBlueprintAction } from "./blueprintActions"

type BlueprintImportWizardProps = {
	onComplete: () => void
	initialBlueprint?: string
}

type AnalysisSummary = {
	communityName: string
	communitySlug: string
	pubFieldCount: number
	pubTypeCount: number
	stageCount: number
	formCount: number
	pubCount: number
	apiTokenCount: number
	userSlots: Array<{ name: string; role: string | null; description: string }>
}

type WizardStep = "paste" | "review" | "create"

export const BlueprintImportWizard = ({
	onComplete,
	initialBlueprint,
}: BlueprintImportWizardProps) => {
	const [step, setStep] = React.useState<WizardStep>(initialBlueprint ? "review" : "paste")
	const [blueprintJson, setBlueprintJson] = React.useState(initialBlueprint ?? "")
	const [summary, setSummary] = React.useState<AnalysisSummary | null>(null)
	const [slugOverride, setSlugOverride] = React.useState("")
	const [nameOverride, setNameOverride] = React.useState("")
	const [isAnalyzing, setIsAnalyzing] = React.useState(false)
	const [isImporting, setIsImporting] = React.useState(false)
	const [importWarnings, setImportWarnings] = React.useState<string[]>([])

	const runAnalyze = useServerAction(analyzeBlueprintAction)
	const runImport = useServerAction(importBlueprintAction)

	const handleAnalyze = React.useCallback(async () => {
		setIsAnalyzing(true)
		const result = await runAnalyze({ blueprintJson })
		setIsAnalyzing(false)

		if (!didSucceed(result) || !result.summary) return

		setSummary(result.summary)
		setSlugOverride(result.summary.communitySlug)
		setNameOverride(result.summary.communityName)
		setStep("review")
	}, [blueprintJson, runAnalyze])

	const handleImport = async () => {
		setIsImporting(true)
		const result = await runImport({
			blueprintJson,
			slugOverride: slugOverride || undefined,
			nameOverride: nameOverride || undefined,
		})
		setIsImporting(false)

		if (!didSucceed(result) || !result.communitySlug) return

		if (result.warnings?.length) {
			setImportWarnings(result.warnings)
		}
		toast.success("Community created successfully")
		setStep("create")
		setTimeout(() => {
			window.location.href = `/c/${result.communitySlug}/stages`
		}, 1500)
	}

	React.useEffect(() => {
		if (initialBlueprint && !summary) {
			void handleAnalyze()
		}
	}, [initialBlueprint, handleAnalyze, summary])

	return (
		<div className="flex flex-col gap-4">
			<StepIndicator current={step} />

			{step === "paste" && (
				<PasteStep
					value={blueprintJson}
					onChange={setBlueprintJson}
					onNext={handleAnalyze}
					isAnalyzing={isAnalyzing}
				/>
			)}

			{step === "review" && summary && (
				<ReviewStep
					summary={summary}
					slugOverride={slugOverride}
					nameOverride={nameOverride}
					onSlugChange={setSlugOverride}
					onNameChange={setNameOverride}
					onBack={() => setStep("paste")}
					onImport={handleImport}
					isImporting={isImporting}
				/>
			)}

			{step === "create" && <CreateStep warnings={importWarnings} onComplete={onComplete} />}
		</div>
	)
}

const StepIndicator = ({ current }: { current: WizardStep }) => {
	const steps: Array<{ key: WizardStep; label: string }> = [
		{ key: "paste", label: "Upload" },
		{ key: "review", label: "Review" },
		{ key: "create", label: "Create" },
	]

	const currentIdx = steps.findIndex((s) => s.key === current)

	return (
		<div className="flex items-center gap-2">
			{steps.map((s, i) => (
				<React.Fragment key={s.key}>
					<div
						className={cn(
							"flex items-center gap-1.5 text-sm",
							i <= currentIdx
								? "font-medium text-foreground"
								: "text-muted-foreground"
						)}
					>
						<span
							className={cn(
								"flex h-6 w-6 items-center justify-center rounded-full text-xs",
								i < currentIdx
									? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
									: i === currentIdx
										? "bg-primary text-primary-foreground"
										: "bg-muted text-muted-foreground"
							)}
						>
							{i < currentIdx ? <CheckCircle size={14} /> : i + 1}
						</span>
						{s.label}
					</div>
					{i < steps.length - 1 && <div className="h-px flex-1 bg-border" />}
				</React.Fragment>
			))}
		</div>
	)
}

type PasteStepProps = {
	value: string
	onChange: (v: string) => void
	onNext: () => void
	isAnalyzing: boolean
}

const PasteStep = ({ value, onChange, onNext, isAnalyzing }: PasteStepProps) => {
	const isValidJson = React.useMemo(() => {
		try {
			JSON.parse(value)
			return true
		} catch {
			return false
		}
	}, [value])

	return (
		<>
			<p className="text-muted-foreground text-sm">
				Paste a community blueprint JSON below, or upload a file.
			</p>

			<div className="h-[300px] rounded-md border">
				<JsonEditor value={value} onChange={onChange} height="300px" />
			</div>

			<div className="flex items-center gap-2">
				<label className="cursor-pointer">
					<input
						type="file"
						accept=".json"
						className="hidden"
						onChange={async (e) => {
							const file = e.target.files?.[0]
							if (!file) return
							const text = await file.text()
							onChange(text)
						}}
					/>
					<span className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
						<Download size={14} className="rotate-180" />
						Upload File
					</span>
				</label>

				<div className="flex-1" />

				<Button size="sm" onClick={onNext} disabled={!isValidJson || isAnalyzing}>
					{isAnalyzing ? (
						<>
							<Loader2 className="animate-spin" size={16} />
							Analyzing...
						</>
					) : (
						<>
							Next
							<ArrowRight size={14} />
						</>
					)}
				</Button>
			</div>
		</>
	)
}

type ReviewStepProps = {
	summary: AnalysisSummary
	slugOverride: string
	nameOverride: string
	onSlugChange: (v: string) => void
	onNameChange: (v: string) => void
	onBack: () => void
	onImport: () => void
	isImporting: boolean
}

const ReviewStep = ({
	summary,
	slugOverride,
	nameOverride,
	onSlugChange,
	onNameChange,
	onBack,
	onImport,
	isImporting,
}: ReviewStepProps) => (
	<>
		<div className="grid gap-4">
			<div className="grid gap-2">
				<Label htmlFor="bp-name">Community Name</Label>
				<Input
					id="bp-name"
					value={nameOverride}
					onChange={(e) => onNameChange(e.target.value)}
				/>
			</div>

			<div className="grid gap-2">
				<Label htmlFor="bp-slug">Community Slug</Label>
				<Input
					id="bp-slug"
					value={slugOverride}
					onChange={(e) => onSlugChange(e.target.value)}
				/>
				<p className="text-muted-foreground text-xs">
					Must be unique. Lowercase letters, numbers, and hyphens only.
				</p>
			</div>

			<div className="rounded-md border p-3">
				<h4 className="mb-2 font-medium text-sm">What will be created</h4>
				<div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
					<SummaryRow label="Pub fields" value={summary.pubFieldCount} />
					<SummaryRow label="Pub types" value={summary.pubTypeCount} />
					<SummaryRow label="Stages" value={summary.stageCount} />
					<SummaryRow label="Forms" value={summary.formCount} />
					<SummaryRow label="Pubs" value={summary.pubCount} />
					<SummaryRow label="API tokens" value={summary.apiTokenCount} />
				</div>
			</div>

			{summary.userSlots.length > 0 && (
				<div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
					<div className="flex items-start gap-2">
						<AlertCircle
							size={16}
							className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
						/>
						<div>
							<h4 className="font-medium text-amber-800 text-sm dark:text-amber-200">
								User references found
							</h4>
							<p className="mt-1 text-amber-700 text-xs dark:text-amber-300">
								This blueprint references {summary.userSlots.length} user
								{summary.userSlots.length !== 1 ? "s" : ""}. User-specific
								configurations (like email recipients) will need to be reconfigured
								after import.
							</p>
							<ul className="mt-2 space-y-1 text-amber-700 text-xs dark:text-amber-300">
								{summary.userSlots.map((slot) => (
									<li key={slot.name}>
										<span className="font-mono">{slot.name}</span>
										{slot.description && (
											<span className="text-amber-600 dark:text-amber-400">
												{" "}
												({slot.description})
											</span>
										)}
									</li>
								))}
							</ul>
						</div>
					</div>
				</div>
			)}
		</div>

		<div className="flex justify-between">
			<Button variant="outline" size="sm" onClick={onBack}>
				<ArrowLeft size={14} />
				Back
			</Button>
			<Button size="sm" onClick={onImport} disabled={isImporting || !slugOverride.trim()}>
				{isImporting ? (
					<>
						<Loader2 className="animate-spin" size={16} />
						Creating...
					</>
				) : (
					"Create Community"
				)}
			</Button>
		</div>
	</>
)

const SummaryRow = ({ label, value }: { label: string; value: number }) => (
	<>
		<span className="text-muted-foreground">{label}</span>
		<span className="font-medium">{value}</span>
	</>
)

type CreateStepProps = {
	warnings: string[]
	onComplete: () => void
}

const CreateStep = ({ warnings, onComplete: _onComplete }: CreateStepProps) => (
	<div className="flex flex-col items-center gap-4 py-6">
		<CheckCircle size={48} className="text-emerald-500" />
		<h3 className="font-medium text-lg">Community Created</h3>
		<p className="text-center text-muted-foreground text-sm">
			Redirecting to the new community...
		</p>
		{warnings.length > 0 && (
			<div className="w-full rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
				<h4 className="mb-1 font-medium text-amber-800 text-sm dark:text-amber-200">
					Import warnings
				</h4>
				<ul className="space-y-1 text-amber-700 text-xs dark:text-amber-300">
					{warnings.map((w, i) => (
						<li key={i}>{w}</li>
					))}
				</ul>
			</div>
		)}
	</div>
)
