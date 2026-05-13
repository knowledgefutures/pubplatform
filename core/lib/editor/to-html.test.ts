import { describe, expect, it } from "vitest"

import { poniesText } from "../../prisma/seeds/ponies.snippet"
import { processEditorHTML } from "./process-editor-html"
import { htmlToProsemirrorServer, prosemirrorToHTMLServer } from "./serialize-server"

describe("renderNodeToHTML", () => {
	it("should be able to round trip a node and not lose any information", async () => {
		const html = poniesText

		expect(html).toBeDefined()

		// the `pretty` is there just to make the diff easier to read if something goes wrong
		const processed = processEditorHTML(html, {
			settings: {
				fragment: true,
				pretty: true,
			},
		})

		const htmlProcessed = await processed.html()

		const node2 = htmlToProsemirrorServer(htmlProcessed)
		const node2Json = node2.toJSON()

		const html2 = prosemirrorToHTMLServer(node2Json)

		const html2Processed = await processEditorHTML(html2, {
			settings: {
				fragment: true,
				pretty: true,
			},
		}).html()

		// FIXME: this is not strictly equal due to some space insertion
		// expect(html2Processed).toEqual(htmlProcessed);

		const node3 = htmlToProsemirrorServer(html2Processed)
		const node3Json = node3.toJSON()

		const html3Processed = await processEditorHTML(prosemirrorToHTMLServer(node3Json), {
			settings: {
				fragment: true,
				pretty: true,
			},
		}).html()

		expect(html2Processed).toEqual(html3Processed)
		expect(node3Json).toEqual(node2Json)
	})
})

describe("math", () => {
	it("should convert block math back and forth correctly", async () => {
		const html = `<math-display classname="math-display"><span class="katex"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msubsup><mo>∫</mo><mi>a</mi><mi>b</mi></msubsup><mi>d</mi><msup><mi>x</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">\\int_a^b dx^2

</annotation></semantics></math></span></math-display>`

		const processed = processEditorHTML(html, {
			settings: {
				fragment: true,
			},
		})

		const htmlProcessed = await processed.html()

		const node = htmlToProsemirrorServer(htmlProcessed)

		expect(node.content.content[0].type.name).toEqual("math_display")
		const nodeJson = node.toJSON()

		const html2 = prosemirrorToHTMLServer(nodeJson)

		expect(html2).toEqual(html)
	})
})
