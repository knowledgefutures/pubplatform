"use client"

import type { EditorState } from "prosemirror-state"
import type { ReactNode } from "react"

import React, { useCallback, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Columns2, Expand, Eye, PencilLine, Shrink } from "lucide-react"

import { cn } from "utils"

import type { ContextEditorProps } from "./ContextEditor"

import ContextEditor from "./ContextEditor"
import { PreviewPanel } from "./components/PreviewPanel"

export type EditorDisplayMode = "inline" | "fullscreen"
export type EditorPaneMode = "editor" | "split" | "preview"

export interface EditorLayoutProps extends ContextEditorProps {
	initialDisplay?: EditorDisplayMode
	initialPanes?: EditorPaneMode
	/** Outer wrapper className (applied in inline mode only). */
	containerClassName?: string
}

export const EditorLayout = (props: EditorLayoutProps) => {
	const {
		initialDisplay = "inline",
		initialPanes = "editor",
		onChange,
		containerClassName,
		...editorProps
	} = props

	const [display, setDisplay] = useState<EditorDisplayMode>(initialDisplay)
	const [panes, setPanes] = useState<EditorPaneMode>(initialPanes)
	const [mobileTab, setMobileTab] = useState<"editor" | "preview">("editor")
	const [editorState, setEditorState] = useState<EditorState | null>(null)
	const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null)

	const handleChange = useCallback<NonNullable<ContextEditorProps["onChange"]>>(
		(state, doc) => {
			setEditorState(state)
			onChange?.(state, doc)
		},
		[onChange]
	)

	useEffect(() => {
		if (display !== "fullscreen") {
			return
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setDisplay("inline")
			}
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [display])

	useEffect(() => {
		if (display !== "fullscreen") {
			return
		}
		const prev = document.body.style.overflow
		document.body.style.overflow = "hidden"
		return () => {
			document.body.style.overflow = prev
		}
	}, [display])

	const rootClass = cn(
		"relative flex flex-col bg-background",
		display === "fullscreen"
			? "fixed inset-0 z-50 h-dvh w-dvw"
			: cn("h-full", containerClassName)
	)

	// Preserve content across the remount that happens when toggling fullscreen
	// (portal → non-portal). Undo history is lost, but the doc is preserved.
	const mountDoc = editorState?.doc ?? editorProps.initialDoc

	// In fullscreen the outer layout sizes the editor; drop any inline-mode
	// sizing className (e.g. `h-96 overflow-scroll`) that would constrain it.
	const innerClassName = display === "fullscreen" ? undefined : editorProps.className

	const tree = (
		<div data-slot="editor-layout" data-display={display} className={rootClass}>
			<div className="flex min-h-10 shrink-0 items-stretch bg-background">
				<div
					ref={setToolbarSlot}
					data-slot="editor-formatting"
					className="min-w-0 flex-1"
				/>
				<LayoutToolbar
					display={display}
					panes={panes}
					onDisplayChange={setDisplay}
					onPanesChange={setPanes}
				/>
			</div>
			<LayoutBody
				panes={panes}
				mobileTab={mobileTab}
				onMobileTabChange={setMobileTab}
				editor={
					<ContextEditor
						{...editorProps}
						className={innerClassName}
						initialDoc={mountDoc}
						onChange={handleChange}
						toolbarContainer={toolbarSlot}
					/>
				}
				preview={
					<PreviewPanel editorState={editorState} initialDoc={mountDoc} />
				}
			/>
		</div>
	)

	if (display === "fullscreen" && typeof document !== "undefined") {
		return createPortal(tree, document.body)
	}
	return tree
}

interface LayoutToolbarProps {
	display: EditorDisplayMode
	panes: EditorPaneMode
	onDisplayChange: (next: EditorDisplayMode) => void
	onPanesChange: (next: EditorPaneMode) => void
}

const LayoutToolbar = ({
	display,
	panes,
	onDisplayChange,
	onPanesChange,
}: LayoutToolbarProps) => {
	const paneOptions: { value: EditorPaneMode; label: string; icon: ReactNode }[] = [
		{ value: "editor", label: "Editor", icon: <PencilLine size={14} /> },
		{ value: "split", label: "Split", icon: <Columns2 size={14} /> },
		{ value: "preview", label: "Preview", icon: <Eye size={14} /> },
	]
	return (
		<div className="flex shrink-0 items-center justify-end gap-1 px-2 py-1">
			<div className="mr-1 flex items-center rounded-md border bg-background p-0.5">
				{paneOptions.map((opt) => (
					<button
						key={opt.value}
						type="button"
						onClick={() => onPanesChange(opt.value)}
						aria-pressed={panes === opt.value}
						aria-label={`${opt.label} view`}
						className={cn(
							"inline-flex h-7 flex-row items-center gap-1.5 whitespace-nowrap rounded px-2 text-xs transition-colors",
							panes === opt.value
								? "bg-secondary text-secondary-foreground"
								: "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
						)}
					>
						{opt.icon}
						<span className="hidden sm:inline">{opt.label}</span>
					</button>
				))}
			</div>
			<button
				type="button"
				onClick={() =>
					onDisplayChange(display === "fullscreen" ? "inline" : "fullscreen")
				}
				aria-label={display === "fullscreen" ? "Exit fullscreen" : "Enter fullscreen"}
				className="inline-flex h-7 flex-row items-center gap-1.5 whitespace-nowrap rounded px-2 text-xs hover:bg-accent hover:text-accent-foreground"
			>
				{display === "fullscreen" ? <Shrink size={14} /> : <Expand size={14} />}
				<span className="hidden sm:inline">
					{display === "fullscreen" ? "Exit" : "Fullscreen"}
				</span>
			</button>
		</div>
	)
}

interface LayoutBodyProps {
	panes: EditorPaneMode
	mobileTab: "editor" | "preview"
	onMobileTabChange: (next: "editor" | "preview") => void
	editor: ReactNode
	preview: ReactNode
}

const LayoutBody = ({ panes, mobileTab, onMobileTabChange, editor, preview }: LayoutBodyProps) => {
	const editorVisibility = paneVisibility("editor", panes, mobileTab)
	const previewVisibility = paneVisibility("preview", panes, mobileTab)

	return (
		<div
			className={cn(
				"flex min-h-0 flex-1 flex-col",
				panes === "split" && "md:flex-row"
			)}
		>
			{panes === "split" && (
				<div className="flex border-b md:hidden" role="tablist" aria-label="Editor view">
					{(["editor", "preview"] as const).map((tab) => (
						<button
							key={tab}
							type="button"
							role="tab"
							aria-selected={mobileTab === tab}
							className={cn(
								"flex-1 border-b-2 py-2 text-sm capitalize",
								mobileTab === tab
									? "border-foreground font-medium"
									: "border-transparent text-muted-foreground"
							)}
							onClick={() => onMobileTabChange(tab)}
						>
							{tab}
						</button>
					))}
				</div>
			)}
			<div
				className={cn(
					"min-h-0 min-w-0 flex-1 overflow-auto",
					panes === "split" && "md:basis-1/2",
					editorVisibility
				)}
			>
				{editor}
			</div>
			<div
				className={cn(
					"min-h-0 min-w-0 flex-1 overflow-auto",
					panes === "split" && "max-md:border-t md:border-l md:basis-1/2",
					previewVisibility
				)}
			>
				{preview}
			</div>
		</div>
	)
}

const paneVisibility = (
	pane: "editor" | "preview",
	panes: EditorPaneMode,
	mobileTab: "editor" | "preview"
): string => {
	if (panes === "editor") {
		return pane === "editor" ? "block" : "hidden"
	}
	if (panes === "preview") {
		return pane === "preview" ? "block" : "hidden"
	}
	return pane === mobileTab ? "block md:block" : "hidden md:block"
}

export default EditorLayout
