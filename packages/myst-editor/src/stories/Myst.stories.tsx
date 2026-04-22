import type { Meta, StoryObj } from "@storybook/react-vite"

import React, { useState } from "react"

import { EditorLayout } from "editor-shell"

import { MystPreview } from "../MystPreview"
import { MystSourceEditor } from "../MystSourceEditor"

const sampleMyst = `---
title: The efficacy of quantum flux transmutation
authors:
  - name: Ada Lovelace
    affiliations:
      - The Analytical Society
---

# Introduction

In this paper, we evaluate the efficacy of **quantum flux transmutation**
under varying field conditions. See @lovelace1843 for prior art.

:::{important}
All measurements were taken at 2.7 K unless otherwise noted.
:::

## Method

The core identity is given by $E = mc^2$, or in display form:

$$
\\oint_{\\partial \\Omega} \\mathbf{F} \\cdot d\\mathbf{S} = \\int_\\Omega (\\nabla \\cdot \\mathbf{F})\\, dV
$$

\`\`\`python
def transmute(flux: float) -> float:
    return flux ** 2 / 137
\`\`\`

:::{figure} /image0.jpg
:label: fig-setup
:align: center

The experimental apparatus.
:::

| Run | Yield | Notes        |
|-----|-------|--------------|
| 1   | 0.42  | baseline     |
| 2   | 0.61  | field at 3 T |

Citations like @lovelace1843 render as [@key] placeholders for now;
cross-reference roles ({ref}) require project-wide State (Phase 4).
`

interface DemoProps {
	initialSource: string
	initialDisplay?: "inline" | "fullscreen"
	initialPanes?: "editor" | "split" | "preview"
	containerClassName?: string
}

const MystEditorDemo = ({
	initialSource,
	initialDisplay,
	initialPanes,
	containerClassName,
}: DemoProps) => {
	const [source, setSource] = useState(initialSource)
	return (
		<EditorLayout
			editor={<MystSourceEditor initialSource={initialSource} onChange={setSource} />}
			preview={<MystPreview source={source} />}
			initialDisplay={initialDisplay}
			initialPanes={initialPanes}
			containerClassName={containerClassName}
		/>
	)
}

const meta = {
	title: "MyST",
	component: MystEditorDemo,
	parameters: { layout: "fullscreen" },
	tags: ["autodocs"],
} satisfies Meta<typeof MystEditorDemo>

export default meta

type Story = StoryObj<typeof meta>

export const Split: Story = {
	args: {
		initialSource: sampleMyst,
		initialPanes: "split",
		containerClassName: "h-[800px] border rounded-md",
	},
}

export const Fullscreen: Story = {
	args: {
		initialSource: sampleMyst,
		initialPanes: "split",
		initialDisplay: "fullscreen",
	},
}
