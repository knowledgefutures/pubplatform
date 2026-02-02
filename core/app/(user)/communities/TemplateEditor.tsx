"use client"

import type { ValidationResult } from "ui/monaco"

import * as React from "react"

import { AlertCircle, CheckCircle, Clipboard, CurlyBraces } from "ui/icon"
import { JsonEditor } from "ui/monaco"
import { toast } from "ui/use-toast"
import { cn } from "utils"

import { communityTemplateSchema } from "~/lib/server/communityTemplate/schema"
import { validateCommunityTemplate } from "~/lib/server/communityTemplate/validate"

type TemplateEditorProps = {
	value: string
	onChange: (value: string) => void
	readOnly?: boolean
	height?: string | number
	className?: string
	showCopyButton?: boolean
	showValidationSummary?: boolean
}

export const TemplateEditor = ({
	value,
	onChange,
	readOnly = false,
	height = "400px",
	className,
	showCopyButton = true,
	showValidationSummary = true,
}: TemplateEditorProps) => {
	const [validationResult, setValidationResult] = React.useState<ValidationResult>({
		valid: true,
		errors: [],
	})
	const [crossRefErrors, setCrossRefErrors] = React.useState<string[]>([])

	const handleValidate = React.useCallback(
		(result: ValidationResult) => {
			setValidationResult(result)

			// run cross-reference validation
			if (result.valid && value.trim()) {
				const crossRefResult = validateCommunityTemplate(value)
				setCrossRefErrors(crossRefResult.errors.map((e) => e.message))
			} else {
				setCrossRefErrors([])
			}
		},
		[value]
	)

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(value)
			toast.success("Copied to clipboard")
		} catch {
			toast.error("Failed to copy to clipboard")
		}
	}

	const allErrors = [...validationResult.errors.map((e) => e.message), ...crossRefErrors]
	const isValid = validationResult.valid && crossRefErrors.length === 0 && value.trim().length > 0

	return (
		<div className={cn("flex flex-col gap-3", className)}>
			<div className="relative">
				<JsonEditor
					value={value}
					onChange={onChange}
					readOnly={readOnly}
					height={height}
					jsonSchema={communityTemplateSchema}
					onValidate={handleValidate}
					showThemeToggle={true}
					showLanguageIndicator={false}
					aria-label="Community template editor"
				/>
				{showCopyButton && (
					<button
						type="button"
						onClick={handleCopy}
						className="absolute top-0.5 right-6 z-10 rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground"
						title="Copy to clipboard"
					>
						<Clipboard size={14} />
					</button>
				)}
			</div>

			{showValidationSummary && (
				<div
					className={cn(
						"flex items-start gap-2 rounded-md px-3 py-2 text-sm",
						isValid
							? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
							: allErrors.length > 0
								? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
								: "bg-muted text-muted-foreground"
					)}
				>
					{isValid ? (
						<>
							<CheckCircle size={16} className="mt-0.5 shrink-0" />
							<span>Template is valid and ready to use</span>
						</>
					) : allErrors.length > 0 ? (
						<>
							<AlertCircle size={16} className="mt-0.5 shrink-0" />
							<div className="flex flex-col gap-1">
								<span className="font-medium">
									{allErrors.length} validation error
									{allErrors.length !== 1 ? "s" : ""}
								</span>
								<ul className="list-inside list-disc text-xs opacity-90">
									{allErrors.slice(0, 5).map((error, i) => (
										<li key={i}>{error}</li>
									))}
									{allErrors.length > 5 && (
										<li>...and {allErrors.length - 5} more</li>
									)}
								</ul>
							</div>
						</>
					) : (
						<>
							<CurlyBraces size={16} className="mt-0.5 shrink-0" />
							<span>Enter a valid community template JSON</span>
						</>
					)}
				</div>
			)}
		</div>
	)
}

// hook for managing template editor state
export const useTemplateEditor = (initialValue = "") => {
	const [value, setValue] = React.useState(initialValue)
	const [isValid, setIsValid] = React.useState(false)

	React.useEffect(() => {
		if (!value.trim()) {
			setIsValid(false)
			return
		}

		try {
			JSON.parse(value)
			const crossRefResult = validateCommunityTemplate(value)
			setIsValid(crossRefResult.valid)
		} catch {
			setIsValid(false)
		}
	}, [value])

	return {
		value,
		setValue,
		isValid,
	}
}
