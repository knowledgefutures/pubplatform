"use client"

import type { NodeViewComponentProps } from "@handlewithcare/react-prosemirror"

import React from "react"

import "prosemirror-gapcursor/style/gapcursor.css"
import "prosemirror-view/style/prosemirror.css"
// For math
import "@benrbray/prosemirror-math/dist/prosemirror-math.css"
import "katex/dist/katex.min.css"

import type { Node } from "prosemirror-model"
import type { ForwardRefExoticComponent, RefAttributes, RefObject } from "react"
import type { FileUploadProps } from "ui/customRenderers/fileUpload/fileUpload"

import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react"
import { ProseMirror, ProseMirrorDoc, reactKeys } from "@handlewithcare/react-prosemirror"
import { EditorState } from "prosemirror-state"
import { fixTables } from "prosemirror-tables"

import { cn } from "utils"

import { AttributePanel } from "./components/AttributePanel"
import { MenuBar } from "./components/MenuBar"
import SuggestPanel from "./components/SuggestPanel"
import { basePlugins } from "./plugins"
import { baseSchema } from "./schemas"
import { EMPTY_DOC } from "./utils/emptyDoc"

export interface ContextEditorGetter {
	getCurrentState: () => EditorState | null
}

export interface ContextEditorProps {
	placeholder?: string
	className?: string /* classname for the editor view */
	disabled?: boolean
	initialDoc?: Node
	// initialHtml?: string;
	pubId: string /* id of the current pub whose field is being directly edited */
	pubTypeId: string /* id of the current pubType of the pub whose field is being directly edited */
	pubTypes: object /* pub types in given context */
	getPubs: (filter: string) => Promise<any[]>
	getPubById: (
		id: string
	) => {} | undefined /* function to get a pub, both for autocomplete, and for id? */
	onChange?: (
		state: EditorState,
		initialDoc: Node
		// initialHtml?: string
	) => void /* Function that passes up editorState so parent can handle onSave, etc */
	atomRenderingComponent: ForwardRefExoticComponent<
		NodeViewComponentProps & RefAttributes<any>
	> /* A react component that is given the ContextAtom pubtype and renders it accordingly */
	hideMenu?: boolean
	upload: FileUploadProps["upload"]

	/**
	 * Ref to the context editor getter
	 * Allows you to retrieve the current state of the editor from the parent component,
	 * rather than having to do it through `onChange` (which usually causes more re-renders)
	 */
	getterRef?: RefObject<ContextEditorGetter | null>
}

export interface SuggestProps {
	isOpen: boolean
	selectedIndex: number
	items: any[]
	filter: string
}

const initSuggestProps: SuggestProps = {
	isOpen: false,
	selectedIndex: 0,
	items: [],
	filter: "",
}

const getEmptyDoc = () => baseSchema.nodeFromJSON(EMPTY_DOC)

const ContextEditor = (props: ContextEditorProps) => {
	const [suggestData, setSuggestData] = useState<SuggestProps>(initSuggestProps)

	const doc = props.initialDoc ?? getEmptyDoc()

	const [editorState, setEditorState] = useState(() => {
		let state = EditorState.create({
			doc,
			schema: baseSchema,
			plugins: [...basePlugins(baseSchema, props, suggestData, setSuggestData), reactKeys()],
		})
		const fix = fixTables(state)
		if (fix) {
			state = state.apply(fix.setMeta("addToHistory", false))
		}
		return state
	})

	// this is slightly evil and should not be taken as an example of good api design
	// it basically allows you to retrieve the value of the editor from the parent component
	// whenever you want, rather than having to do it through `onChange` (which would also cause a re-render)
	// this makes (some) sense in this case bc the editor is almost fully uncontrolled:
	// you cannot pass in an `EditorState` that holds the actual value
	useImperativeHandle(
		props.getterRef,
		() => ({
			getCurrentState: () => editorState,
		}),
		[editorState]
	)

	const nodeViews = useMemo(() => {
		return { contextAtom: props.atomRenderingComponent }
	}, [props.atomRenderingComponent])

	useEffect(() => {
		if (!props.onChange) {
			return
		}
		props.onChange(editorState, doc)
	}, [editorState, doc, props.onChange])

	const containerRef = useRef<HTMLDivElement>(null)
	const containerId = useId()

	return (
		<div
			id={containerId}
			ref={containerRef}
			className={cn("relative isolate max-w-full md:max-w-(--breakpoint-sm)", {
				"editor-disabled": props.disabled,
			})}
		>
			<ProseMirror
				state={editorState}
				dispatchTransaction={(tr) => {
					setEditorState((s) => s.apply(tr))
				}}
				nodeViews={nodeViews}
				editable={() => !props.disabled}
				className={cn("font-serif", props.className)}
			>
				{props.hideMenu ? null : (
					<div className="sticky top-0 z-10">
						<MenuBar upload={props.upload} />
					</div>
				)}
				<ProseMirrorDoc />
				<AttributePanel menuHidden={!!props.hideMenu} containerRef={containerRef} />
				<SuggestPanel
					suggestData={suggestData}
					setSuggestData={setSuggestData}
					containerRef={containerRef}
				/>
			</ProseMirror>
		</div>
	)
}

// to be sure
ContextEditor.displayName = "ContextEditor"

export default ContextEditor
