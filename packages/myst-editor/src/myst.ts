import { mystParse } from "myst-parser"
import { mystToHtml } from "myst-to-html"

type AnyNode = { type: string; children?: AnyNode[]; [k: string]: unknown }

/**
 * Walk the parsed MyST AST and replace unresolved `cite` nodes with a plain
 * text placeholder (`[@key]`). Without a bibliography-backed State, mystToHtml
 * renders them as empty `<div>`s and drops the key. Proper citation rendering
 * lands in Phase 4 when we have project-wide State.
 */
const stubUnresolvedCitations = (node: AnyNode): void => {
	if (!node.children) {
		return
	}
	for (let i = 0; i < node.children.length; i++) {
		const child = node.children[i]
		if (child.type === "cite") {
			const id = (child.identifier as string | undefined) ?? (child.label as string | undefined)
			node.children[i] = {
				type: "text",
				value: id ? `[@${id}]` : "[@?]",
			}
			continue
		}
		stubUnresolvedCitations(child)
	}
}

/**
 * Parse a MyST markdown source string and render it to HTML.
 *
 * Phase 2 uses this for the live preview pane. No project-wide transforms
 * (cross-refs, real citations against a bibliography, etc.) are applied —
 * those require a populated `State` and are deferred until we wire up
 * multi-pub rendering in Phase 4. Math nodes are emitted as raw LaTeX in
 * `<span class="math-inline">` / `<div class="math-display">` elements;
 * `MystPreview` runs KaTeX over those after mount.
 */
export const mystSourceToHtml = (source: string): string => {
	const tree = mystParse(source)
	stubUnresolvedCitations(tree as unknown as AnyNode)
	return mystToHtml(tree, { formatHtml: true })
}
