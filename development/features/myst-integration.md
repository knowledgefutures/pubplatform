# MyST Markdown Integration

## Overview

Integrate MyST (Markedly Structured Text) into the PubPub platform to provide a structured, extensible authoring format for scholarly content. MyST extends CommonMark with roles (inline markup) and directives (block-level components), making it well-suited for academic publishing workflows with cross-references, citations, math, and embedded metadata.

This feature is broken into four phases. Each phase is independently shippable and builds on the previous.

---

## Phase 1: Fullscreen + Side-by-Side Editing and Preview

**Goal:** Improve the context editor's editing experience with a fullscreen mode and live preview panel, establishing the UI patterns that MyST authoring will use.

### Scope

- Fullscreen editing mode for the context editor (ProseMirror)
- Side-by-side layout: editor on the left, rendered preview on the right
- Toggle between fullscreen/inline and editor-only/split/preview-only views
- Responsive behavior (collapse to tabbed on small screens)

### Notes

- The `EditorDash` storybook component already demonstrates a multi-panel layout with JSON, pubs, and site preview panels. This phase productionizes and extends that pattern.
- The preview pane will initially render the ProseMirror document as HTML. In Phase 2 it will also support MyST source rendering.
- Consider whether the fullscreen editor should be a modal overlay or a route-level layout.

### Dependencies

- None (works with existing context editor)

### Implementation Plan

**Approach:** CSS-based fullscreen overlay (fixed-inset container + Escape keybinding + body scroll lock), rather than Radix `Dialog` or a route-level layout. Keeps Phase 1 self-contained inside `packages/context-editor` plus a toggle in the form element, avoids new routing work, and stays reusable for Phase 2's MyST source mode. Tradeoff: no URL/deep-link story for fullscreen — acceptable for a UI-only phase. Radix `Dialog` was considered and rejected because its portal would remount the ProseMirror subtree on every toggle, dropping undo history and cursor position.

**Key anchors in current code:**

- `ContextEditor` — `packages/context-editor/src/ContextEditor.tsx:82` (top-level PM editor, single-column today)
- `ContextEditorElement` — `core/app/components/forms/elements/ContextEditorElement.tsx:40` (react-hook-form mount point on the pub edit page)
- `prosemirrorToHTML()` — `packages/context-editor/src/utils/serialize.ts:10` (existing PM → HTML serializer; preview reuses this)
- `EditorDash` storybook — `packages/context-editor/src/stories/EditorDash/EditorDash.tsx` (prior-art multi-panel layout with `SitePanel` preview; this phase productionizes the pattern)
- UI primitives: Radix-based shadcn (`Dialog`, `Sheet`, `Popover`) in `packages/ui`. No resizable-pane primitive exists in the repo — use Tailwind grid/flex.

**Steps:**

1. New `EditorLayout` component in `packages/context-editor` wrapping `ContextEditor`. Owns two pieces of view state:
   - `display: "inline" | "fullscreen"`
   - `panes: "editor" | "split" | "preview"`
2. `PreviewPanel` component that calls `prosemirrorToHTML()` on editor state changes, debounced. Initially renders HTML into a styled container; no MyST yet (Phase 2).
3. Split layout via Tailwind `md:grid-cols-2`; no external resize library. Fixed 50/50 split unless a draggable divider proves necessary.
4. Fullscreen toggle button in `ContextEditorElement` (and/or `MenuBar`); fullscreen mode mounts `EditorLayout` inside `Dialog` sized to viewport.
5. Responsive behavior: below `md`, collapse split view to a tab switcher (editor / preview).

**Out of scope for Phase 1:**

- MyST source editing or rendering (Phase 2)
- Storing preview state or persisting pane layout across sessions
- Route-level fullscreen / deep-linkable editor URLs

---

## Phase 2: MyST Authoring — Basic Styling, Preview, and Rendering

**Goal:** Allow authors to write and preview MyST markdown within the platform, with correct rendering of standard MyST constructs.

### Scope

- MyST source editing mode (CodeMirror with MyST syntax highlighting)
- Toggle between ProseMirror WYSIWYG and MyST source modes
- Live preview rendering of MyST content using the `mystmd` toolchain (parse to AST, render to HTML)
- Support for standard MyST constructs:
  - Directives: admonitions, figures, code blocks, math, tables
  - Roles: inline math, cross-references, citations, abbreviations
  - Frontmatter (title, authors, affiliations, etc.)
- Styling: base theme for rendered MyST output consistent with PubPub's design system
- Storage: determine whether MyST source is stored alongside or instead of ProseMirror HTML (likely a new `MyST` schema type for pub fields)

### Open Questions

- **Roundtrip fidelity:** Can we convert between ProseMirror doc and MyST losslessly, or are they separate content tracks?
- **Storage format:** Store MyST source as plaintext and render on demand? Or store the parsed AST?
- **Dependency management:** `mystmd` is a Node.js toolchain. Rendering could happen client-side, server-side, or in the site builder.

### Dependencies

- Phase 1 (fullscreen/preview layout)

### Implementation Plan

**First slice:** Rather than tackle the full scope at once, start with (a) a MyST *source* editing mode that slots into the existing `EditorLayout` as an alternative to ProseMirror, and (b) client-side MyST → HTML preview. Defer ProseMirror ↔ MyST roundtrip, storage schema changes, and server-side rendering to a later sub-phase.

**Approach:** Treat ProseMirror and MyST as **parallel content tracks per field** (a mode toggle, not a conversion). Addresses the "Roundtrip fidelity" open question by sidestepping it: in v1, a field is authored in one mode or the other, and switching modes does not attempt to convert existing content. Tradeoff: no seamless migration yet; users who start in ProseMirror can't carry their doc into MyST without manual re-entry.

**Key anchors in current code:**

- `EditorLayout` — `packages/context-editor/src/EditorLayout.tsx` (display/panes state, formatting-bar slot; the new source mode is another state dimension alongside these)
- `PreviewPanel` — `packages/context-editor/src/components/PreviewPanel.tsx` (HTML render target; MyST preview mirrors this API)
- CodeMirror 6 deps already in `packages/context-editor/package.json` (including `@codemirror/lang-markdown`) — no new CM deps needed for v1

**MyST rendering stack (client-side):** `myst-parser` + `myst-to-html` + `unified` + `rehype-stringify`. All ESM, browser-safe (Vite-friendly), jupyter-book/mystmd. No `mystmd` CLI dep. Per-published-package size is small; parsing is synchronous via `processSync`.

**Steps:**

1. Add `myst-parser`, `myst-to-html`, `unified`, `rehype-stringify` to `packages/context-editor`.
2. `MystSourceEditor` — new component wrapping CodeMirror 6 with `@codemirror/lang-markdown`. Accepts `initialSource: string`, emits `onChange(source)`. No MyST-specific highlighting in v1 (no CM6 MyST grammar exists); directives render as code-fence-ish blocks. Acceptable gap.
3. `MystPreview` — mirrors `PreviewPanel`; accepts `source: string`, debounces, pipes through the mystmd pipeline to an HTML string, renders via `dangerouslySetInnerHTML`.
4. Extend `EditorLayout` with `sourceMode: "prosemirror" | "myst"` state + a toggle button (placed near the existing view controls). When `myst`, the editor pane renders `MystSourceEditor` instead of `ContextEditor`, and the preview pane renders `MystPreview`.
5. Storybook story seeding a MyST sample (admonition, figure, math, frontmatter) to verify rendering.

**Out of scope for this slice:**

- ProseMirror ↔ MyST conversion (round-trip or one-way)
- Persisting MyST source to the DB (new schema, migration, field type) — preview works from in-memory state only
- Server-side / site-builder rendering — Phase 4
- MyST-specific CodeMirror syntax highlighting — deferred until an upstream grammar exists or we write one
- Custom PubPub directives (`:::{pub}`) — Phase 3

---

## Phase 3: Custom Directives and Pub Includes

**Goal:** Extend MyST with PubPub-specific directives that reference pubs, pub fields, and community data — enabling structured, data-driven documents.

### Scope

- Custom MyST directives for embedding pub data:
  ```
  :::{pub} <pub-id-or-slug>
  :field: title
  :::
  ```
  or inline roles: `` {pub:field}`slug:title` ``
- Pub include/transclusion: embed one pub's content within another document
- Field value interpolation: reference pub field values in MyST templates (similar to existing `$.pub.values` interpolation in site builder templates)
- Directive registration API: allow communities to define custom directives backed by pub types
- Autocompletion in the MyST source editor for directive names, pub slugs, and field names

### Design Considerations

- This overlaps with the existing `contextAtom`/`contextDoc` ProseMirror nodes. Those embed pubs in the WYSIWYG editor; these directives would be the MyST-source equivalent.
- The existing remark-based markdown pipeline (`renderMarkdownWithPub.ts`) already supports custom directives (`:value{field=...}`, `:link{...}`). Consider aligning the MyST directive syntax with this existing pattern.
- Directive resolution should work both at edit-time (preview) and at build-time (site builder).

### Dependencies

- Phase 2 (MyST rendering pipeline)

---

## Phase 4: Site Builder Integration

**Goal:** Use MyST as a first-class template and content format in the site builder, enabling communities to build sites from MyST-authored content.

### Scope

- Site builder can consume MyST source from pub fields and render to HTML pages
- MyST templates: page templates written in MyST (with directives for layout, navigation, pub listings)
- Cross-references resolved across pubs within a site build (e.g., citation links between articles)
- Output formats beyond HTML: PDF (via Typst/LaTeX), JATS XML for journal submission
- Integration with the existing JSONata-based page group system:
  - MyST content as the `transform` expression output
  - Or: MyST templates as an alternative to JSONata transforms for content-heavy pages

### Design Considerations

- The `mystmd` CLI already supports multi-document projects with cross-references, TOC generation, and export to HTML/PDF/JATS. Evaluate whether the site builder should shell out to `mystmd` or use the JS API directly.
- MyST's structured AST (`myst-spec`) could serve as an intermediate representation between pub content and final output, replacing or complementing the current HTML-centric pipeline.
- Consider incremental builds: MyST's dependency graph (cross-references, includes) could inform which pages need rebuilding.

### Dependencies

- Phase 3 (custom directives for pub data)
- Site builder 2 architecture (core sends pub IDs + templates, builder fetches and renders)

---

## Cross-Cutting Concerns

### Content Model

The current content pipeline is: **ProseMirror doc -> HTML -> stored in DB -> served/rendered**. MyST introduces an alternative track: **MyST source -> AST -> HTML/PDF/JATS**. Key decisions:

- Do we support both tracks per field, or is it a per-field-type choice?
- Is the ProseMirror schema extended to represent MyST constructs (bidirectional), or are they parallel formats?

### Migration

- Existing ProseMirror content should continue working as-is.
- Consider a one-way export: ProseMirror doc -> MyST source (for authors who want to switch).

### Performance

- MyST parsing/rendering is non-trivial. Cache parsed ASTs where possible.
- Preview rendering should be debounced and potentially run in a web worker.

### Extensibility

- MyST's directive/role system is inherently extensible. Define a clear boundary between "standard MyST," "PubPub built-in directives," and "community-defined directives."
