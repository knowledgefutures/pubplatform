"use client"

import type { editor, IDisposable } from "monaco-editor"
import type { JsonataContextSchema, MonacoEditorProps, MonacoTheme } from "./types"

import * as React from "react"
import { Moon, Sun } from "lucide-react"

import { cn } from "utils"

import { Button } from "../button"
import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip"
import { useMonaco, useValidation } from "./hooks"
import {
	createJsonataCompletionProvider,
	createJsonataHoverProvider,
	inferSchemaFromExample,
} from "./languages/jsonata"

const LANGUAGE_LABELS: Record<string, string> = {
	json: "JSON",
	jsonata: "JSONata",
	javascript: "JavaScript",
	typescript: "TypeScript",
	html: "HTML",
	css: "CSS",
}

export const MonacoEditor = React.forwardRef<HTMLDivElement, MonacoEditorProps>(
	function MonacoEditor(
		{
			value,
			onChange,
			language = "json",
			theme: initialTheme = "dark",
			height = "200px",
			minHeight,
			className,
			placeholder: _placeholder,
			readOnly = false,
			lineNumbers = true,
			minimap = false,
			wordWrap = true,
			jsonSchema,
			jsonataContext,
			onValidate,
			showLanguageIndicator = true,
			showThemeToggle = true,
			"aria-label": ariaLabel,
			"aria-labelledby": ariaLabelledby,
			"aria-describedby": ariaDescribedby,
		},
		ref
	) {
		const monaco = useMonaco()
		const containerRef = React.useRef<HTMLDivElement>(null)
		const editorRef = React.useRef<editor.IStandaloneCodeEditor | null>(null)
		const disposablesRef = React.useRef<IDisposable[]>([])
		const [currentTheme, setCurrentTheme] = React.useState<MonacoTheme>(initialTheme)

		// use refs for values that shouldnt trigger editor recreation
		const onChangeRef = React.useRef(onChange)
		onChangeRef.current = onChange

		const valueRef = React.useRef(value)
		valueRef.current = value

		React.useImperativeHandle(ref, () => containerRef.current as HTMLDivElement)

		const contextSchema = React.useMemo(() => {
			if (!jsonataContext) return undefined
			if ("type" in jsonataContext && jsonataContext.type === "object") {
				return jsonataContext as JsonataContextSchema
			}
			const inferred = inferSchemaFromExample(jsonataContext)
			if (inferred.type === "object") {
				return inferred as JsonataContextSchema
			}
			return undefined
		}, [jsonataContext])

		// setup json schema when it changes
		React.useEffect(() => {
			if (!monaco || language !== "json") return

			if (jsonSchema) {
				monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
					validate: true,
					allowComments: false,
					schemas: [
						{
							uri: "inmemory://model/schema.json",
							fileMatch: ["*"],
							schema: jsonSchema,
						},
					],
				})
			} else {
				monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
					validate: true,
					allowComments: false,
					schemas: [],
				})
			}
		}, [monaco, jsonSchema, language])

		const themeRef = React.useRef(currentTheme)
		themeRef.current = currentTheme

		// setup editor once when monaco is ready
		React.useEffect(() => {
			if (!monaco || !containerRef.current || editorRef.current) return

			const monacoTheme = themeRef.current === "light" ? "pubstar-light" : "pubstar-dark"

			const newEditor = monaco.editor.create(containerRef.current, {
				value: valueRef.current,
				language,
				theme: monacoTheme,
				automaticLayout: true,
				minimap: { enabled: minimap },
				lineNumbers: lineNumbers ? "on" : "off",
				wordWrap: wordWrap ? "on" : "off",
				readOnly,
				scrollBeyondLastLine: false,
				fontSize: 13,
				fontFamily:
					"ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace",
				padding: { top: 8, bottom: 8 },
				renderLineHighlight: "none",
				overviewRulerLanes: 0,
				hideCursorInOverviewRuler: true,
				scrollbar: {
					vertical: "auto",
					horizontal: "auto",
					verticalScrollbarSize: 8,
					horizontalScrollbarSize: 8,
				},
				ariaLabel: ariaLabel ?? "Code editor",
			})

			editorRef.current = newEditor

			const changeDisposable = newEditor.onDidChangeModelContent(() => {
				const newValue = newEditor.getValue()
				onChangeRef.current(newValue)
			})
			disposablesRef.current.push(changeDisposable)

			if (language === "jsonata") {
				const completionDisposable = monaco.languages.registerCompletionItemProvider(
					"jsonata",
					createJsonataCompletionProvider(monaco, contextSchema)
				)
				const hoverDisposable = monaco.languages.registerHoverProvider(
					"jsonata",
					createJsonataHoverProvider(contextSchema)
				)
				disposablesRef.current.push(completionDisposable, hoverDisposable)
			}

			return () => {
				for (const d of disposablesRef.current) {
					d.dispose()
				}
				disposablesRef.current = []
				newEditor.dispose()
				editorRef.current = null
			}
		}, [monaco, language, contextSchema, minimap, lineNumbers, wordWrap, readOnly, ariaLabel])

		// update theme when it changes
		React.useEffect(() => {
			if (!monaco || !editorRef.current) return
			const monacoTheme = currentTheme === "light" ? "pubstar-light" : "pubstar-dark"
			monaco.editor.setTheme(monacoTheme)
		}, [monaco, currentTheme])

		// sync value from outside without recreating editor
		React.useEffect(() => {
			if (!editorRef.current) return
			const currentValue = editorRef.current.getValue()
			if (currentValue !== value) {
				editorRef.current.setValue(value)
			}
		}, [value])

		const validation = useValidation(value, language, onValidate)

		// update markers based on validation
		React.useEffect(() => {
			if (!monaco || !editorRef.current) return

			const model = editorRef.current.getModel()
			if (!model) return

			const markers: editor.IMarkerData[] = validation.errors.map((err) => ({
				severity:
					err.severity === "error"
						? monaco.MarkerSeverity.Error
						: err.severity === "warning"
							? monaco.MarkerSeverity.Warning
							: monaco.MarkerSeverity.Info,
				message: err.message,
				startLineNumber: err.line,
				startColumn: err.column,
				endLineNumber: err.endLine ?? err.line,
				endColumn: err.endColumn ?? err.column + 1,
			}))

			monaco.editor.setModelMarkers(model, "validation", markers)
		}, [monaco, validation])

		const toggleTheme = React.useCallback(() => {
			setCurrentTheme((prev) => (prev === "light" ? "dark" : "light"))
		}, [])

		const computedHeight = typeof height === "number" ? `${height}px` : height
		const computedMinHeight = minHeight
			? typeof minHeight === "number"
				? `${minHeight}px`
				: minHeight
			: undefined

		return (
			<div
				className={cn(
					"relative w-full overflow-hidden rounded-md border border-input",
					"bg-background",
					"focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
					className
				)}
				style={{ height: computedHeight, minHeight: computedMinHeight }}
				data-labelledby={ariaLabelledby}
				data-describedby={ariaDescribedby}
			>
				{(showLanguageIndicator || showThemeToggle) && (
					<div className="absolute top-1 right-1 z-10 flex items-center gap-1">
						{showLanguageIndicator && (
							<span
								className={cn(
									"rounded px-1.5 py-0.5 font-mono text-[10px]",
									currentTheme === "dark"
										? "bg-neutral-800 text-neutral-400"
										: "bg-neutral-100 text-neutral-600"
								)}
							>
								{LANGUAGE_LABELS[language] ?? language}
							</span>
						)}
						{showThemeToggle && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										className={cn(
											"h-5 w-5",
											currentTheme === "dark"
												? "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
												: "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800"
										)}
										onClick={toggleTheme}
									>
										{currentTheme === "dark" ? (
											<Sun size={12} />
										) : (
											<Moon size={12} />
										)}
									</Button>
								</TooltipTrigger>
								<TooltipContent>
									Switch to {currentTheme === "dark" ? "light" : "dark"} theme
								</TooltipContent>
							</Tooltip>
						)}
					</div>
				)}
				<div ref={containerRef} className="h-full w-full">
					{!monaco && (
						<div className="flex h-full items-center justify-center text-muted-foreground text-sm">
							Loading editor...
						</div>
					)}
				</div>
			</div>
		)
	}
)
