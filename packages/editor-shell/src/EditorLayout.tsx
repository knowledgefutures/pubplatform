"use client"

import type { ReactNode } from "react"

import React, { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Columns2, Expand, Eye, PencilLine, Shrink } from "lucide-react"

import { cn } from "utils"

export type EditorDisplayMode = "inline" | "fullscreen"
export type EditorPaneMode = "editor" | "split" | "preview"

export interface EditorLayoutProps {
	/** Content of the editor pane. */
	editor: ReactNode
	/** Content of the preview pane. */
	preview: ReactNode
	/**
	 * Called with the formatting-bar slot DOM node whenever it mounts.
	 * Consumers can pass this node to editor implementations that portal
	 * a toolbar into it (e.g. ContextEditor's `toolbarContainer` prop).
	 */
	onToolbarSlotChange?: (slot: HTMLDivElement | null) => void
	/** Extra controls rendered in the toolbar, left of the pane + fullscreen buttons. */
	extraToolbarControls?: ReactNode
	initialDisplay?: EditorDisplayMode
	initialPanes?: EditorPaneMode
	/** Outer wrapper className (applied in inline mode only). */
	containerClassName?: string
}

export const EditorLayout = ({
	editor,
	preview,
	onToolbarSlotChange,
	extraToolbarControls,
	initialDisplay = "inline",
	initialPanes = "editor",
	containerClassName,
}: EditorLayoutProps) => {
	const [display, setDisplay] = useState<EditorDisplayMode>(initialDisplay)
	const [panes, setPanes] = useState<EditorPaneMode>(initialPanes)
	const [mobileTab, setMobileTab] = useState<"editor" | "preview">("editor")

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

	const tree = (
		<div data-slot="editor-layout" data-display={display} className={rootClass}>
			<div className="flex min-h-10 shrink-0 items-stretch border-b bg-background">
				<div
					ref={onToolbarSlotChange ?? null}
					data-slot="editor-formatting"
					className="min-w-0 flex-1"
				/>
				<LayoutToolbar
					display={display}
					panes={panes}
					onDisplayChange={setDisplay}
					onPanesChange={setPanes}
					extraControls={extraToolbarControls}
				/>
			</div>
			<LayoutBody
				panes={panes}
				mobileTab={mobileTab}
				onMobileTabChange={setMobileTab}
				editor={editor}
				preview={preview}
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
	extraControls?: ReactNode
}

const LayoutToolbar = ({
	display,
	panes,
	onDisplayChange,
	onPanesChange,
	extraControls,
}: LayoutToolbarProps) => {
	const paneOptions: { value: EditorPaneMode; label: string; icon: ReactNode }[] = [
		{ value: "editor", label: "Editor", icon: <PencilLine size={16} /> },
		{ value: "split", label: "Split", icon: <Columns2 size={16} /> },
		{ value: "preview", label: "Preview", icon: <Eye size={16} /> },
	]
	return (
		<div className="flex shrink-0 items-center justify-end gap-1.5 px-2 py-1">
			{extraControls}
			<div className="mr-1 flex items-center gap-0.5 rounded-md border bg-background p-1">
				{paneOptions.map((opt) => (
					<button
						key={opt.value}
						type="button"
						onClick={() => onPanesChange(opt.value)}
						aria-pressed={panes === opt.value}
						aria-label={`${opt.label} view`}
						className={cn(
							"inline-flex h-9 flex-row items-center gap-2 whitespace-nowrap rounded-sm px-3 text-sm transition-colors",
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
				className="inline-flex h-9 flex-row items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm hover:bg-accent hover:text-accent-foreground"
			>
				{display === "fullscreen" ? <Shrink size={16} /> : <Expand size={16} />}
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
