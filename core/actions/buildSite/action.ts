import { Globe2 } from "lucide-react"
import * as z from "zod"

import { Action } from "db/public"

import { defineAction } from "../types"

// default CSS for built sites
export const DEFAULT_SITE_CSS = `
:root {
  --color-bg: #ffffff;
  --color-text: #1a1a1a;
  --color-muted: #6b7280;
  --color-border: #e5e7eb;
  --color-accent: #3b82f6;
  --font-sans: system-ui, -apple-system, sans-serif;
  --font-mono: ui-monospace, monospace;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font-sans);
  line-height: 1.6;
  color: var(--color-text);
  background: var(--color-bg);
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem 1rem;
}

h1, h2, h3 { line-height: 1.3; margin-bottom: 0.5em; }
h1 { font-size: 2rem; }
h2 { font-size: 1.5rem; color: var(--color-muted); }

.pub-field { margin-bottom: 1.5rem; }
.pub-field-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-muted);
  margin-bottom: 0.25rem;
}
.pub-field-value { font-size: 1rem; }
.pub-field-value:empty::after { content: "—"; color: var(--color-muted); }

a { color: var(--color-accent); }
pre, code { font-family: var(--font-mono); font-size: 0.875rem; }
pre { background: #f3f4f6; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; }
`.trim()

// default template that iterates through all pub values
// $.pub.values is an object with field slugs as keys
export const DEFAULT_PAGE_TEMPLATE = `
'<article>' &
  '<h1>' & $.pub.title & '</h1>' &
  $join(
   $map(
   $filter($keys($.pub.values),function($v){ $not($contains($v, ":"))}),
  function($v){
      '<div class="pub-field">' &
        '<div class="pub-field-label">' & $v & '</div>' &
        '<div class="pub-field-value">' & 
          $string($lookup($.pub.values, $v)) & '</div>' &
      '</div>'
    }),
    ''
  ) &
'</article>'

`.trim()

const schema = z.object({
	subpath: z
		.string()
		.optional()
		.describe(
			"Subpath for deployment (e.g., 'journal-2024'). If not provided, uses the automation run ID."
		),
	css: z
		.string()
		.optional()
		.describe("Custom CSS for the generated pages. Leave empty to use the default styles."),
	bannerText: z
		.string()
		.optional()
		.describe("Text to display in the site banner. If not provided, no banner is shown."),
	pages: z
		.array(
			z.object({
				filter: z
					.string()
					.describe("A filter expression that selects which pubs to include"),
				slug: z.string().describe("JSONata expression for the page URL slug"),
				transform: z
					.string()
					.describe("JSONata expression that outputs content for the page"),
				headExtra: z
					.string()
					.optional()
					.describe(
						"JSONata expression for additional HTML to inject into <head> (e.g. <link> tags). Only applies to HTML pages."
					),
				extension: z
					.string()
					.default("html")
					.describe(
						"File extension for the generated output (e.g., 'html', 'json', 'xml'). Only 'html' pages are wrapped in an HTML shell. If content starts with <!DOCTYPE, it is used as-is without wrapping."
					),
			})
		)
		.min(1)
		.max(10),
	outputMap: z
		.array(z.object({ pubField: z.string(), responseField: z.string() }))
		.optional()
		.describe("Map response fields to pub fields"),
})

export const action = defineAction({
	name: Action.buildSite,
	niceName: "Build Site",
	accepts: ["json", "pub"],
	superAdminOnly: true,
	experimental: true,
	config: {
		schema,
		interpolation: {
			// we will do manual interpolation for the filter and transform expressions
			exclude: ["pages"],
		},
	},
	description: "Build a site",
	icon: Globe2,
})
