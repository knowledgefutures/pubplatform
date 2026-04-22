"use client"

import React, { useEffect, useRef, useState } from "react"
import katex from "katex"

import "katex/dist/katex.min.css"

import { cn } from "utils"

import { mystSourceToHtml } from "./myst"

const renderMathIn = (root: HTMLElement) => {
	const apply = (selector: string, displayMode: boolean) => {
		root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
			if (el.dataset.katexRendered === "true") {
				return
			}
			try {
				katex.render(el.textContent ?? "", el, {
					displayMode,
					throwOnError: false,
				})
				el.dataset.katexRendered = "true"
			} catch {
				// leave raw LaTeX in place on failure
			}
		})
	}
	apply(".math-display", true)
	apply(".math-inline", false)
}

interface MystPreviewProps {
	source: string
	debounceMs?: number
	className?: string
}

export const MystPreview = ({ source, debounceMs = 150, className }: MystPreviewProps) => {
	const [html, setHtml] = useState<string>("")
	const [error, setError] = useState<string | null>(null)
	const timerRef = useRef<number | null>(null)
	const containerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (timerRef.current !== null) {
			window.clearTimeout(timerRef.current)
		}
		timerRef.current = window.setTimeout(() => {
			try {
				setHtml(mystSourceToHtml(source))
				setError(null)
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err))
			}
		}, debounceMs)
		return () => {
			if (timerRef.current !== null) {
				window.clearTimeout(timerRef.current)
			}
		}
	}, [source, debounceMs])

	useEffect(() => {
		if (containerRef.current && html) {
			renderMathIn(containerRef.current)
		}
	}, [html])

	if (error) {
		return (
			<div
				data-slot="myst-preview"
				className={cn("p-6 font-mono text-destructive text-sm", className)}
			>
				<div className="font-medium">MyST parse error</div>
				<pre className="mt-2 whitespace-pre-wrap">{error}</pre>
			</div>
		)
	}

	return (
		<div
			ref={containerRef}
			data-slot="myst-preview"
			className={cn(
				"prose prose-sm max-w-none p-6 font-serif",
				"[--tw-prose-body:var(--foreground)] [--tw-prose-headings:var(--foreground)] [--tw-prose-bold:var(--foreground)] [--tw-prose-quotes:var(--foreground)] [--tw-prose-code:var(--foreground)] [--tw-prose-counters:var(--foreground)] [--tw-prose-bullets:var(--foreground)]",
				className
			)}
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	)
}
