import type { PubsId } from "db/public"
import type { Node as NodeMdast, Parent as ParentMdast } from "mdast"
import type { Directive as MicromarkDirective } from "micromark-extension-directive"
import type { Plugin, Processor } from "unified"
import type { Node } from "unist"
import type { LinkOptions } from "./renderWithPubUtils"

import assert from "node:assert"
import rehypeFormat from "rehype-format"
import rehypeRemark from "rehype-remark"
import rehypeStringify from "rehype-stringify"
import remarkDirective from "remark-directive"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import remarkStringify from "remark-stringify"
import { unified } from "unified"
import { visit } from "unist-util-visit"

import { CoreSchemaType } from "db/public"
import { expect } from "utils"

import { hydratePubValues } from "~/lib/fields/utils"
import { getPubTitle } from "~/lib/pubs"
import { getExclusivelyRelatedPub } from "../../pub"
import { RenderWithPubToken } from "./renderWithPubTokens"
import * as utils from "./renderWithPubUtils"

const ERR_FORM_MISSING_RECIPIENT = `You can't use :link{form="slug"} directive with an email address. You must set the "Recipient member" field.`

type Directive = NodeMdast & MicromarkDirective

const isDirective = (node: Node): node is Directive => {
	return (
		node.type === "containerDirective" ||
		node.type === "leafDirective" ||
		node.type === "textDirective"
	)
}

const isParent = (node: Node): node is ParentMdast => {
	return "children" in node
}

const visitValueDirective = (node: Directive, context: utils.RenderWithPubContext) => {
	const attrs = expect(node.attributes, "Invalid syntax in value directive")
	const field = expect(attrs.field, "Missing field attribute in value directive")

	let value: unknown = attrs.fallback
	let valueIsUrl = false

	const hydratedPubValues = hydratePubValues(context.pub.values)

	if (field === "title") {
		value = getPubTitle(context.pub)
	} else {
		const val = hydratedPubValues.find((value) => value.fieldSlug === field)

		if (val !== undefined) {
			if (val.schemaName === CoreSchemaType.URL) {
				valueIsUrl = true
			}
			value =
				val.schemaName === CoreSchemaType.DateTime
					? // get the date in YYYY-MM-DD format
						// we should allow the user to specify this
						new Date(val.value as string).toISOString().split("T")[0]
					: val.value
		}
	}

	assert(
		value !== undefined,
		`Missing value for ${field}. You can avoid this error by adding a fallback like so: ":value{field=<field name> fallback=<some value>}"`
	)

	node.data = {
		...node.data,
		hName: valueIsUrl ? "a" : "span",
		hChildren: [
			{
				type: "text",
				value: String(value),
			},
		],
		hProperties: {
			...node.data?.hProperties,
			...(valueIsUrl ? { href: String(value) } : {}),
		},
	}
}

const hasRelationRel = (node: Directive) => {
	return node.attributes?.rel !== undefined && node.attributes.rel !== "parent"
}

const visitRecipientNameDirective = (node: Directive, context: utils.RenderWithPubContext) => {
	node.data = {
		...node.data,
		hName: "span",
		hChildren: [
			{
				type: "text",
				value: utils.renderRecipientFullName(context, node.name),
			},
		],
	}
}

const visitRecipientFirstNameDirective = (node: Directive, context: utils.RenderWithPubContext) => {
	node.data = {
		...node.data,
		hName: "span",
		hChildren: [
			{
				type: "text",
				value: utils.renderRecipientFirstName(context, node.name),
			},
		],
	}
}

const visitRecipientLastNameDirective = (node: Directive, context: utils.RenderWithPubContext) => {
	node.data = {
		...node.data,
		hName: "span",
		hChildren: [
			{
				type: "text",
				value: utils.renderRecipientLastName(context, node.name),
			},
		],
	}
}

const visitLinkDirective = (node: Directive, context: utils.RenderWithPubContext) => {
	// `node.attributes` should always be defined for directive nodes
	const attrs = expect(node.attributes, "Invalid syntax in link directive") as LinkOptions
	// All directives are considered parent nodes
	assert(isParent(node))
	let href: string
	// :link{email=all@pubstar.org}
	if ("email" in attrs) {
		// The `email` attribute must have a value. For example, :link{email=""}
		// is invalid.
		const email = expect(attrs.email, 'Unexpected missing value in ":link{email=?}" directive')
		href = utils.renderLink(context, { email })
		// If the email has no label, default to the email address, e.g.
		// :link{email=all@pubstar.org} -> :link[all@pubstar.org]{email=all@pubstar.org}
		if (node.children.length === 0 && attrs.text === undefined) {
			node.children.push({ type: "text", value: email })
		}
	}
	// :link{form=review}
	else if ("form" in attrs) {
		href = utils.renderLink(context, {
			form: expect(attrs.form, 'Unexpected missing value in ":link{form=?}" directive'),
		})
	}
	// :link{to=https://example.com}
	else if ("to" in attrs) {
		href = utils.renderLink(context, {
			to: expect(attrs.to, 'Unexpected missing value in ":link{to=?}" directive'),
		})
	}
	// :link{field=pubpub:url}
	else if ("field" in attrs) {
		href = utils.renderLink(context, {
			field: expect(attrs.field, "Unexpected missing value in ':link{field=?}' directive"),
			rel: attrs.rel,
		})
	} else if ("page" in attrs) {
		href = utils.renderLink(context, {
			page: expect(attrs.page, "Unexpected missing value in ':link{page=?}' directive"),
		})
	} else {
		throw new Error("Invalid link directive")
	}

	// Default the text content to the href if the node has no children
	if (node.children.length === 0) {
		node.children.push({
			type: "text",
			value: attrs.text ?? href,
		})
	}
	node.data = {
		...node.data,
		hName: "a",
		hProperties: { href },
	}
}

const visitValueDirectiveWithMemberField: DirectiveVisitor = async (node, context) => {
	// Insert and extract the member id
	visitValueDirective(node, context)
	const children = expect(node.data?.hChildren)
	// Replace the member id with a formatted string (e.g. firstName + lastName)
	const attrs = expect(node.attributes)
	children[0] = {
		...children[0],
		type: "text",
		value: await utils.renderMemberFields({
			fieldSlug: expect(attrs.field),
			attributes: Object.keys(attrs),
			memberId: expect((children[0] as any).value),
			communitySlug: context.communitySlug,
		}),
	}
}

type DirectiveVisitor = (node: Directive, context: utils.RenderWithPubContext) => void

const directiveVisitors: Record<RenderWithPubToken, DirectiveVisitor> = {
	[RenderWithPubToken.Value]: visitValueDirective,
	[RenderWithPubToken.RecipientName]: visitRecipientNameDirective,
	[RenderWithPubToken.RecipientFirstName]: visitRecipientFirstNameDirective,
	[RenderWithPubToken.RecipientLastName]: visitRecipientLastNameDirective,
	[RenderWithPubToken.Link]: visitLinkDirective,
}

const asyncVisitors = new Set([visitValueDirectiveWithMemberField])

const getDirectiveVisitor = (node: Directive) => {
	const directiveName = node.name.toLowerCase() as RenderWithPubToken
	if (
		directiveName === RenderWithPubToken.Value &&
		utils.ALLOWED_MEMBER_ATTRIBUTES.some((f) => f in (node.attributes ?? []))
	) {
		return visitValueDirectiveWithMemberField
	}
	return expect(
		directiveVisitors[directiveName],
		`Invalid directive ${directiveName} used in markdown template.`
	)
}

const renderMarkdownWithPubPlugin: Plugin<[utils.RenderWithPubContext]> = (context) => {
	return async (tree) => {
		const authLinkNodes: Directive[] = []
		const deferredNodes: Directive[] = []

		visit(tree, (node) => {
			if (isDirective(node)) {
				// Directive names are case-insensitive
				const directiveName = node.name.toLowerCase() as RenderWithPubToken
				const directiveVisitor = getDirectiveVisitor(node)
				// Some links, like private form links, require one-time token authentication
				const directiveRendersAuthLink =
					directiveName === RenderWithPubToken.Link && node.attributes?.form !== undefined

				// Collect all auth link nodes to be processed after all other directives
				if (directiveRendersAuthLink) {
					authLinkNodes.push(node)
				}

				if (hasRelationRel(node) || asyncVisitors.has(directiveVisitor)) {
					deferredNodes.push(node)
					return
				}

				// Process the directive
				directiveVisitor(node, context)
			}
		})

		// Append one-time auth tokens to authenticated hrefs.
		await Promise.all(
			authLinkNodes.map(async (node) => {
				const data = expect(node.data)
				const props = expect(data.hProperties)
				if (isDirective(node)) {
					const attrs = expect(node.attributes)
					if ("form" in attrs) {
						props.href = await utils.renderFormInviteLink(
							{
								formSlug: expect(attrs.form),
								recipient: expect(context.recipient, ERR_FORM_MISSING_RECIPIENT),
								communityId: context.communityId,
								pubId: context.pub.id as PubsId,
								inviter: expect(context.inviter),
							},
							context.trx
						)
						assert(isParent(node))
						// Include default text
						node.children = [
							{
								type: "text",
								value: attrs.text ?? props.href,
							},
						]
					}
				}
			})
		)

		// Process deferred nodes
		await Promise.all(
			deferredNodes.map(async (node) => {
				const visitor = getDirectiveVisitor(node)
				// Override context for nodes with rel="relation_field"
				if (hasRelationRel(node)) {
					const { rel, ...attrs } = expect(node.attributes)
					const relatedPub = expect(
						await getExclusivelyRelatedPub(context.pub.id as PubsId, rel),
						`The markdown template included a directive containing rel="${rel}", but the pub is not related to any other pubs through this field.`
					)
					node.attributes = attrs
					await visitor(node, {
						...context,
						pub: relatedPub as utils.RenderWithPubPub,
					})
				} else {
					await visitor(node, context)
				}
			})
		)
	}
}

const process = async <T extends Processor<Node, Node, Node, any, string>>(
	processor: T,
	text: string
) => {
	const result = await processor.process(text)

	return result.toString().trim()
}

export const renderMarkdownWithPub = async (
	text: string,
	context: utils.RenderWithPubContext,
	asMarkdown = false
) => {
	const processorBase = unified()
		.use(remarkParse)
		.use(remarkDirective)
		.use(renderMarkdownWithPubPlugin, context)
		.use(remarkRehype)
		.use(rehypeFormat)

	if (asMarkdown) {
		// Convert the HTML back to markdown using rehype-remark
		const processor = processorBase.use(rehypeRemark).use(remarkStringify)
		return process(processor, text)
	}

	const processor = processorBase.use(rehypeStringify)
	return process(processor, text)
}

export const renderMarkdownAsHtml = async (text: string) => {
	const processor = unified()
		.use(remarkParse)
		.use(remarkDirective)
		.use(remarkRehype)
		.use(rehypeFormat)
		.use(rehypeStringify)

	const result = await processor.process(text)

	return result.toString().trim()
}
