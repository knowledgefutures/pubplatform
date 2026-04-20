import type { Meta, StoryObj } from "@storybook/react-vite"

import React from "react"

import { EditorLayout } from "../EditorLayout"
import { baseSchema } from "../schemas"
import AtomRenderer from "./AtomRenderer"
import initialDoc from "./initialDoc.json"
import initialTypes from "./initialTypes.json"
import { generateSignedAssetUploadUrl, getPubs } from "./mockUtils"

const meta = {
	title: "EditorLayout",
	component: EditorLayout,
	parameters: { layout: "fullscreen" },
	tags: ["autodocs"],
	argTypes: {
		placeholder: { control: "text" },
		initialDisplay: {
			control: "inline-radio",
			options: ["inline", "fullscreen"],
		},
		initialPanes: {
			control: "inline-radio",
			options: ["editor", "split", "preview"],
		},
	},
} satisfies Meta<typeof EditorLayout>

export default meta

type Story = StoryObj<typeof meta>

const pubId = "a85b4157-4a7f-40d8-bb40-d9c17a6c7a70"
const upload = (filename: string) => generateSignedAssetUploadUrl(`${pubId}/${filename}`)

const baseArgs = {
	placeholder: "Write here...",
	initialDoc: baseSchema.nodeFromJSON(initialDoc),
	pubTypes: initialTypes,
	pubId,
	pubTypeId: "67704c04-4f04-46e9-b93e-e3988a992a9b",
	getPubs,
	onChange: () => {},
	getPubById: () => undefined,
	atomRenderingComponent: AtomRenderer,
	upload,
}

/** Inline mode, editor-only — should behave like the plain ContextEditor with a toolbar on top. */
export const Inline: Story = {
	args: {
		...baseArgs,
		initialDisplay: "inline",
		initialPanes: "editor",
		containerClassName: "h-[600px] border rounded-md",
	},
}

/** Split view: editor on the left, live HTML preview on the right. Resize the viewport below `md` to see the tab collapse. */
export const Split: Story = {
	args: {
		...baseArgs,
		initialDisplay: "inline",
		initialPanes: "split",
		containerClassName: "h-[600px] border rounded-md",
	},
}

/** Preview-only: no editor surface, just the serialized HTML output. Useful for sanity-checking `prosemirrorToHTML`. */
export const PreviewOnly: Story = {
	args: {
		...baseArgs,
		initialDisplay: "inline",
		initialPanes: "preview",
		containerClassName: "h-[600px] border rounded-md",
	},
}

/** Starts in fullscreen — covers the viewport, Escape returns to inline. */
export const Fullscreen: Story = {
	args: {
		...baseArgs,
		initialDisplay: "fullscreen",
		initialPanes: "split",
	},
}
