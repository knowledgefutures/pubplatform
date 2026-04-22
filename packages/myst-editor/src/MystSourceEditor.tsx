"use client"

import React, { useEffect, useRef } from "react"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { EditorState } from "@codemirror/state"
import { EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view"

import { cn } from "utils"

export interface MystSourceEditorProps {
	initialSource?: string
	onChange?: (source: string) => void
	className?: string
	disabled?: boolean
}

export const MystSourceEditor = ({
	initialSource = "",
	onChange,
	className,
	disabled,
}: MystSourceEditorProps) => {
	const containerRef = useRef<HTMLDivElement>(null)
	const viewRef = useRef<EditorView | null>(null)
	const onChangeRef = useRef(onChange)
	onChangeRef.current = onChange

	useEffect(() => {
		if (!containerRef.current) {
			return
		}
		const state = EditorState.create({
			doc: initialSource,
			extensions: [
				lineNumbers(),
				highlightActiveLine(),
				history(),
				keymap.of([...defaultKeymap, ...historyKeymap]),
				markdown({ base: markdownLanguage }),
				syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
				EditorView.editable.of(!disabled),
				EditorView.lineWrapping,
				EditorView.updateListener.of((update) => {
					if (update.docChanged && onChangeRef.current) {
						onChangeRef.current(update.state.doc.toString())
					}
				}),
				EditorView.theme({
					"&": { height: "100%", fontSize: "14px" },
					".cm-scroller": {
						fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
					},
				}),
			],
		})
		const view = new EditorView({ state, parent: containerRef.current })
		viewRef.current = view
		return () => {
			view.destroy()
			viewRef.current = null
		}
		// Editor is uncontrolled — only mount once. Prop changes do not re-create it.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	return (
		<div
			ref={containerRef}
			data-slot="myst-source-editor"
			className={cn("h-full overflow-auto", className)}
		/>
	)
}
