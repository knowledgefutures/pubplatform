"use client"

import type { EditorState } from "prosemirror-state"

import React, { useCallback, useState } from "react"
import { EditorLayout as ShellEditorLayout } from "editor-shell"

import type { EditorDisplayMode, EditorPaneMode } from "editor-shell"

import type { ContextEditorProps } from "./ContextEditor"

import ContextEditor from "./ContextEditor"
import { PreviewPanel } from "./components/PreviewPanel"

export type { EditorDisplayMode, EditorPaneMode } from "editor-shell"

export interface EditorLayoutProps extends ContextEditorProps {
	initialDisplay?: EditorDisplayMode
	initialPanes?: EditorPaneMode
	/** Outer wrapper className (applied in inline mode only). */
	containerClassName?: string
}

/**
 * ProseMirror-flavored EditorLayout: wraps editor-shell's generic layout with
 * ContextEditor as the editor pane and a PreviewPanel rendering the PM doc
 * as HTML. Other editor surfaces (e.g. myst-editor) compose the shell
 * themselves with their own editor + preview.
 */
export const EditorLayout = (props: EditorLayoutProps) => {
	const {
		initialDisplay = "inline",
		initialPanes = "editor",
		containerClassName,
		onChange,
		...editorProps
	} = props

	const [editorState, setEditorState] = useState<EditorState | null>(null)
	const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null)

	const handleChange = useCallback<NonNullable<ContextEditorProps["onChange"]>>(
		(state, doc) => {
			setEditorState(state)
			onChange?.(state, doc)
		},
		[onChange]
	)

	const mountDoc = editorState?.doc ?? editorProps.initialDoc

	return (
		<ShellEditorLayout
			initialDisplay={initialDisplay}
			initialPanes={initialPanes}
			containerClassName={containerClassName}
			onToolbarSlotChange={setToolbarSlot}
			editor={
				<ContextEditor
					{...editorProps}
					initialDoc={mountDoc}
					onChange={handleChange}
					toolbarContainer={toolbarSlot}
				/>
			}
			preview={<PreviewPanel editorState={editorState} initialDoc={mountDoc} />}
		/>
	)
}

export default EditorLayout
