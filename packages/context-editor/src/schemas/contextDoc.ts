import type { DOMOutputSpec, NodeSpec } from "prosemirror-model"

export default {
	selectable: false,
	content: "block+",
	group: "block",
	defining: true,
	// isolating: true, /* Isolating sounds like we might want it, but makes it impossible to press Return twice to escape the section and return to the regular doc */
	attrs: {
		id: { default: null },
		class: { default: null },
		pubId: { default: null },
		pubTypeId: { default: null },
		parentPubId: { default: null },
		fieldSlug: { default: null },
		data: { default: null },
	},
	parseDOM: [
		{
			tag: "section",
			getAttrs: (node) => {
				if ((node as Element).getAttribute("data-atom")) {
					return false
				}
				return {
					id: (node as Element).getAttribute("id"),
					class: (node as Element).getAttribute("class"),
					pubId: (node as Element).getAttribute("data-pub-id"),
					parentPubId: (node as Element).getAttribute("data-parent-pub-id"),
					fieldSlug: (node as Element).getAttribute("data-field-slug"),
					pubTypeId: (node as Element).getAttribute("data-pub-type-id"),
				}
			},
		},
	],
	toDOM: (node) => {
		return [
			"section",
			{
				class: node.attrs.class,
				...(node.attrs.id && { id: node.attrs.id }),
				"data-pub-id": node.attrs.pubId?.toString(),
				"data-parent-pub-id": node.attrs.parentPubId?.toString(),
				"data-field-slug": node.attrs.fieldSlug?.toString(),
				"data-pub-type-id": node.attrs.pubTypeId?.toString(),
			},
			0,
		] as DOMOutputSpec
	},
} satisfies NodeSpec

/* 
I didn't call this "transclude" because that implies real-time, 
continual linking. I propose we lean away from that, into a more
explicit 'include' model. More like a package-lock file than a 
dynamic transclusion model.

Should this use @pubstar/prosemirror-reactive?
It seems like the core function is similar, we want to
include an up-to-date value of a field based on some stored 
permanent id. Maybe we don't? Maybe we want to snapshot the 
transcluded item and lets users update?

Another approach is:
- Store the id of the transcluded pub
- Allow editing of that value, update source when necessary.
*/
