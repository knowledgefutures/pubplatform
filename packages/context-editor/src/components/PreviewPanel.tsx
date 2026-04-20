"use client"

import type { Node } from "prosemirror-model"
import type { EditorState } from "prosemirror-state"

import React, { useEffect, useRef, useState } from "react"

import { cn } from "utils"

import { prosemirrorToHTML } from "../utils/serialize"

interface PreviewPanelProps {
	editorState: EditorState | null
	initialDoc?: Node
	debounceMs?: number
	className?: string
}

export const PreviewPanel = ({
	editorState,
	initialDoc,
	debounceMs = 150,
	className,
}: PreviewPanelProps) => {
	const [html, setHtml] = useState<string>("")
	const timerRef = useRef<number | null>(null)

	useEffect(() => {
		if (html !== "" || !initialDoc) {
			return
		}
		try {
			setHtml(prosemirrorToHTML(initialDoc))
		} catch {
			// no-op: initial render before document is available
		}
	}, [initialDoc, html])

	useEffect(() => {
		if (!editorState) {
			return
		}
		if (timerRef.current !== null) {
			window.clearTimeout(timerRef.current)
		}
		timerRef.current = window.setTimeout(() => {
			setHtml(prosemirrorToHTML(editorState.doc))
		}, debounceMs)
		return () => {
			if (timerRef.current !== null) {
				window.clearTimeout(timerRef.current)
			}
		}
	}, [editorState, debounceMs])

	return (
		<div
			data-slot="editor-preview"
			className={cn(
				"prose prose-sm max-w-none p-6 font-serif",
				"[--tw-prose-body:var(--foreground)] [--tw-prose-headings:var(--foreground)] [--tw-prose-bold:var(--foreground)] [--tw-prose-quotes:var(--foreground)] [--tw-prose-code:var(--foreground)] [--tw-prose-counters:var(--foreground)] [--tw-prose-bullets:var(--foreground)]",
				className
			)}
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	)
}
