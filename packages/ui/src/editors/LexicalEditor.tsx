import type { EditorState, LexicalNode } from "lexical"
import type { ControllerRenderProps } from "react-hook-form"

import * as React from "react"
import { CodeNode } from "@lexical/code"
import { LinkNode } from "@lexical/link"
import { ListItemNode, ListNode } from "@lexical/list"
import {
	$convertFromMarkdownString,
	$convertToMarkdownString,
	TRANSFORMERS,
} from "@lexical/markdown"
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode"
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { HeadingNode, QuoteNode } from "@lexical/rich-text"

import { cn } from "utils"

import { useTokenContext } from "../tokens"
import { JsonataNode } from "./JsonataNode"
import { JsonataPlugin } from "./JsonataPlugin"
import { SingleLinePlugin } from "./SingleLinePlugin"
import { TokenNode } from "./TokenNode"
import { TokenPlugin } from "./TokenPlugin"

const theme = {
	token: "token",
	jsonataToken: "jsonata-token",
}

function onError(_error: unknown) {}

const NODES = [
	HorizontalRuleNode,
	CodeNode,
	HeadingNode,
	LinkNode,
	ListNode,
	ListItemNode,
	QuoteNode,
	TokenNode,
	JsonataNode,
]

const makeSyntheticChangeEvent = (value: string) => {
	return {
		target: {
			value,
		},
	}
}

export type LexicalEditorProps = ControllerRenderProps<any, string> & {
	withMarkdown?: boolean
	singleLine?: boolean
	"aria-labelledby"?: string
	allowedNodes?: LexicalNode[]
}

export const LexicalEditor = (props: LexicalEditorProps) => {
	const initialValue = React.useMemo(() => props.value ?? "", [props.value])
	const initialConfig = React.useMemo(() => {
		return {
			namespace: "LexicalEditor",
			theme,
			onError,
			editorState: () => $convertFromMarkdownString(initialValue, TRANSFORMERS),
			nodes: NODES,
		}
	}, [initialValue])
	const tokens = useTokenContext()

	const onChange = React.useCallback(
		(editorState: EditorState) => {
			editorState.read(() => {
				const markdown = $convertToMarkdownString(TRANSFORMERS)
				props.onChange(makeSyntheticChangeEvent(markdown))
			})
		},
		[props.onChange]
	)

	return (
		<LexicalComposer initialConfig={initialConfig}>
			<RichTextPlugin
				contentEditable={
					<ContentEditable
						id={props.name}
						ariaLabelledBy={props["aria-labelledby"]}
						className={cn(
							"editor",
							"prose prose-sm dark:prose-invert",
							props.singleLine ? "min-h-5" : "min-h-[200px]",
							// Copied from ui/src/input.tsx
							"w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-sm placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
							"focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
							"aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40"
						)}
					/>
				}
				placeholder={null}
				ErrorBoundary={LexicalErrorBoundary}
			/>
			<OnChangePlugin onChange={onChange} />
			<HistoryPlugin />
			<AutoFocusPlugin />
			{props.singleLine && <SingleLinePlugin />}
			{props.withMarkdown && <MarkdownShortcutPlugin transformers={TRANSFORMERS} />}
			<TokenPlugin tokens={Object.keys(tokens[props.name] ?? {})} />
			<JsonataPlugin />
		</LexicalComposer>
	)
}
