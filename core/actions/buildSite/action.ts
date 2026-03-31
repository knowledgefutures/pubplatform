import { Globe2 } from "lucide-react"
import * as z from "zod"

import { Action } from "db/public"

import { defineAction } from "../types"

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
	pages: z
		.array(
			z.object({
				filter: z
					.string()
					.optional()
					.describe(
						"A filter expression that selects which pubs to include. If omitted, the group produces a single static file."
					),
				slug: z.string().describe("JSONata expression for the page URL slug"),
				transform: z
					.string()
					.describe("JSONata expression that outputs content for the page"),
				extension: z
					.string()
					.default("html")
					.describe(
						"File extension for the generated output (e.g., 'html', 'json', 'xml', 'css'). Only 'html' pages are wrapped in an HTML shell. If content starts with <!DOCTYPE, it is used as-is without wrapping."
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
