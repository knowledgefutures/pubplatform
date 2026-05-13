import type { CommunitiesId, UsersId } from "db/public"

import { faker } from "@faker-js/faker"
import { defaultMarkdownParser } from "prosemirror-markdown"

import {
	Action,
	AutomationConditionBlockType,
	AutomationEvent,
	ConditionEvaluationTiming,
	CoreSchemaType,
	ElementType,
	FormAccessType,
	InputComponent,
	MemberRole,
	StructuralFormElement,
} from "db/public"

import { env } from "~/lib/env/env"
import { seedCommunity } from "../seed/seedCommunity"
import { usersNew } from "./users"

export async function seedStarter(communityId?: CommunitiesId) {
	const memberId = crypto.randomUUID() as UsersId

	return seedCommunity(
		{
			community: {
				id: communityId,
				name: "Starter",
				slug: "starter",
				avatar: `${env.PUBSTAR_URL}/demo/croc.png`,
			},
			pubFields: {
				Title: { schemaName: CoreSchemaType.String },
				Content: { schemaName: CoreSchemaType.RichText },
				Email: { schemaName: CoreSchemaType.Email },
				URL: { schemaName: CoreSchemaType.URL },
				MemberID: { schemaName: CoreSchemaType.MemberId },
				"ok?": { schemaName: CoreSchemaType.Boolean },
				File: { schemaName: CoreSchemaType.FileUpload },
				Confidence: { schemaName: CoreSchemaType.Vector3 },
				"Published At": { schemaName: CoreSchemaType.DateTime },
				"File Upload": { schemaName: CoreSchemaType.FileUpload },
				Evaluations: { schemaName: CoreSchemaType.Null, relation: true },
				Submissions: { schemaName: CoreSchemaType.Null, relation: true },
				Color: { schemaName: CoreSchemaType.Color },
				Body: { schemaName: CoreSchemaType.String },
			},
			pubTypes: {
				Article: {
					Title: { isTitle: true },
					Content: { isTitle: false },
					Email: { isTitle: false },
					URL: { isTitle: false },
					MemberID: { isTitle: false },
					"ok?": { isTitle: false },
					File: { isTitle: false },
					Confidence: { isTitle: false },
					"Published At": { isTitle: false },
					"File Upload": { isTitle: false },
					Evaluations: { isTitle: false },
					Color: { isTitle: false },
				},
				Evaluation: {
					Title: { isTitle: true },
					Content: { isTitle: false },
					Email: { isTitle: false },
					URL: { isTitle: false },
					MemberID: { isTitle: false },
					"ok?": { isTitle: false },
					File: { isTitle: false },
					Confidence: { isTitle: false },
					"Published At": { isTitle: false },
					Color: { isTitle: false },
				},
				"Review Offer": {
					Title: { isTitle: true },
					Content: { isTitle: false },
					URL: { isTitle: false },
				},
			},
			users: {
				new: {
					id: memberId,
					firstName: "Croc",
					email: "new@pubstar.org",
					lastName: "Croc",
					password: "pubstar-new",
					role: MemberRole.admin,
				},
				...usersNew,
			},
			pubs: [
				{
					pubType: "Article",
					values: {
						Title: "Ancient Giants: Unpacking the Evolutionary History of Crocodiles from Prehistoric to Present",
						Content: defaultMarkdownParser.parse(faker.lorem.paragraph(1)).toJSON(),
						Email: "new@pubstar.org",
						URL: "https://pubpub.org",
						MemberID: memberId,
						"ok?": true,
						Confidence: [0, 0, 0],
						"Published At": new Date(),
					},
					relatedPubs: {
						Evaluations: [
							{
								value: null,
								pub: {
									pubType: "Evaluation",
									values: {
										Title: "Evaluation of Ancient Giants",
										"Published At": new Date(),
									},
									stage: "Draft",
								},
							},
						],
					},
					stage: "Draft",
				},
				{
					pubType: "Article",
					values: {
						Title: "Snap! The Crocodilian Chronicles: A Scaly Tale of Survival and Swamp Supremacy",
						Content: defaultMarkdownParser.parse(faker.lorem.paragraph(1)).toJSON(),
						Email: "new@pubstar.org",
						URL: "https://pubpub.org",
						MemberID: memberId,
						"ok?": true,
						Confidence: [0, 0, 0],
						"Published At": new Date(),
					},
					relatedPubs: {
						Evaluations: [
							{
								value: null,
								pub: {
									pubType: "Evaluation",
									values: {
										Title: "Evaluation of Snap!",
										"Published At": new Date(),
									},
									stage: "Draft",
								},
							},
						],
					},
					stage: "Draft",
				},
				{
					pubType: "Review Offer",
					values: {
						Title: "First big review offer",
						Body: "{}",
						URL: "https://pubpub.org",
					},
					stage: "Inbox",
				},
			],
			forms: {
				"Public Review (without relation)": {
					access: FormAccessType.public,
					pubType: "Evaluation",
					slug: "public-review",
					elements: [
						{
							type: ElementType.structural,
							element: StructuralFormElement.p,
							content: `# Review\n\n Thank you for agreeing to review this Pub, please do not be a meany bobeeny.`,
						},
						{
							field: "Title",
							type: ElementType.pubfield,
							component: InputComponent.textInput,
							config: {
								label: "Title",
								maxLength: 255,
								help: "Give your review a snazzy title.",
							},
						},
						{
							field: "Content",
							type: ElementType.pubfield,
							component: InputComponent.richText,
							config: {
								label: "Content",
								help: "Enter your review here",
							},
						},
						{
							field: "File",
							type: ElementType.pubfield,
							component: InputComponent.fileUpload,
							config: {
								label: "Attachment",
								help: "Please attach the file for your review here.",
							},
						},
						{
							type: ElementType.button,
							content: `Go see your pubs :link{page='currentPub' text='here'}`,
							label: "Submit",
							stage: "Draft",
						},
					],
				},
				"Private Review (with relation)": {
					slug: "private-review",
					access: FormAccessType.private,
					pubType: "Evaluation",
					elements: [
						{
							type: ElementType.structural,
							element: StructuralFormElement.p,
							content: `# Review\n\n Thank you for agreeing to review this Pub, please do not be a meany bobeeny.`,
						},
						{
							field: "Title",
							type: ElementType.pubfield,
							component: InputComponent.textInput,
							config: {
								label: "Title",
								maxLength: 255,
								help: "Give your review a snazzy title.",
							},
						},
						{
							field: "Content",
							type: ElementType.pubfield,
							component: InputComponent.richText,
							config: {
								label: "Content",
								help: "Enter your review here",
							},
						},
						{
							field: "File",
							type: ElementType.pubfield,
							component: InputComponent.fileUpload,
							config: {
								label: "Attachment",
								help: "Please attach the file for your review here.",
							},
						},
						{
							field: "Submissions",
							type: ElementType.pubfield,
							component: null,
							relatedPubTypes: ["Article"],
							config: {
								relationshipConfig: {
									label: "Related Article",
									help: "Please select the article you are reviewing.",
									component: InputComponent.relationBlock,
								},
							},
						},
						{
							type: ElementType.button,
							content: `Go see your pubs :link{page='currentPub' text='here'}`,
							label: "Submit",
							stage: "Published",
						},
					],
					members: ["contributor"],
				},
			},
			stages: {
				Draft: {
					members: { new: MemberRole.contributor },
					automations: {
						"Log Review": {
							triggers: [
								{
									event: AutomationEvent.manual,
									config: {},
								},
								{
									event: AutomationEvent.pubEnteredStage,
									config: {},
								},
							],
							actions: [
								{
									action: Action.log,
									config: {},
								},
							],

							condition: {
								type: AutomationConditionBlockType.AND,
								items: [
									{
										kind: "condition",
										type: "jsonata",
										expression:
											'$.pub.values.title = "Ancient Giants: Unpacking the Evolutionary History of Crocodiles from Prehistoric to Present"',
									},
									{
										kind: "block",
										type: AutomationConditionBlockType.OR,
										items: [
											{
												kind: "condition",
												type: "jsonata",
												expression: '$.pub.pubType.name = "Article"',
											},
											{
												kind: "condition",
												type: "jsonata",
												expression: '$.pub.pubType.name = "Evaluation"',
											},
										],
									},
								],
							},
						},

						"Send Public Review email": {
							triggers: [
								{
									event: AutomationEvent.manual,
									config: {},
								},
							],
							actions: [
								{
									action: Action.email,
									config: {
										subject: "Hello, :recipientName! Please review this draft!",
										recipient: memberId,
										body: `You are invited to fill in a form.\n\n\n\n:link{form="public-review" text="I've never been so excited about a form"}\n\nCurrent time: :value{field='starter:published-at'}`,
									},
								},
							],
						},
						"Send Private Review email": {
							triggers: [
								{
									event: AutomationEvent.manual,
									config: {},
								},
							],
							actions: [
								{
									action: Action.email,
									config: {
										subject: "HELLO REVIEW OUR STUFF PLEASE... privately",
										recipientEmail: "james@jimothy.org",
										body: `You are invited to fill in a form.\n\n\n\n:link{form="private-review" text="Wow, a great form!"}\n\nCurrent time: :value{field='starter:published-at'}`,
									},
								},
							],
						},
						"Log Pub in Stage For Duration": {
							triggers: [
								{
									event: AutomationEvent.pubInStageForDuration,
									config: {
										duration: 1,
										interval: "minute",
									},
								},
							],
							timing: ConditionEvaluationTiming.both,
							condition: {
								type: AutomationConditionBlockType.OR,
								items: [
									{
										kind: "condition",
										type: "jsonata",
										expression: '$.pub.pubType.name = "Article"',
									},
								],
							},
							actions: [
								{
									action: Action.log,
									config: {
										text: "Pub {{ $.pub.title }} is in stage {{ $.stage.name }} for one minute",
									},
								},
							],
						},
						"Log with Resolved Pub": {
							triggers: [
								{
									event: AutomationEvent.manual,
									config: {},
								},
							],
							// This resolver expression finds a pub by matching the current pub's email field
							// against other pubs' email values, effectively resolving to a related pub
							resolver: `$.pub.values.email = $.pub.values.email`,
							actions: [
								{
									action: Action.log,
									config: {
										text: "Resolved pub: {{ $.pub.values.title }}",
									},
								},
							],
						},
					},
				},
				Published: {
					members: { new: MemberRole.contributor },
				},
				Inbox: {
					automations: {
						"Respond to Activity": {
							icon: {
								name: "activity",
								color: "#3b82f6",
							},
							triggers: [
								{
									event: AutomationEvent.webhook,
									config: {
										path: "inbox",
									},
								},
							],

							condition: {
								type: AutomationConditionBlockType.AND,
								items: [
									{
										kind: "condition",
										type: "jsonata",
										expression: '"Announce" in $.json.type',
									},
									{
										kind: "condition",
										type: "jsonata",
										expression: '"coar-notify:ReviewAction" in $.json.type',
									},
								],
							},
							actions: [
								{
									action: Action.createPub,

									config: {
										stage: "Inbox",
										formSlug: "inbox-form",
										pubType: "Review Offer",
										pubValues: {
											Title: "Incoming {{ $.json.id }}",
											Body: "{{ $.json.body }}",
											URL: "{{ $.json.object.id }}",
										},
									},
								},
							],
						},
						"Send Review Offer": {
							icon: {
								name: "alert-circle",
								color: "#f59e0b",
							},
							triggers: [
								{
									event: AutomationEvent.manual,
									config: {},
								},
							],
							actions: [
								{
									action: Action.http,
									config: {
										url: "https://postman-echo.com/post",
										method: "POST",
										body: `
{
  "id": "urn:uuid:{{ $.automationRun.id }}",
  "updated": "2024-11-28T15:20:58.780000",
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://purl.org/coar/notify"
  ],
  "type": [
    "Announce",
    "coar-notify:ReviewAction"
  ],
  "origin": {
    "id": "{{ $.community.url }}",
    "inbox": "{{ $.community.url }}/api/v0/c/{{ $.community.slug }}/site/webhook/inbox",
    "type": "Service"
  },
  "target": {
    "id": "{{ $.community.url }}",
    "inbox": "{{ $.community.url }}/api/v0/c/{{ $.community.slug }}/site/webhook/inbox",
    "type": "Service"
  },
  "object": {
    "id": "{{ $.pub.id }}",
    "object": {{ $.pub }},
    "type": "preprint",
    "ietf:cite-as": null,
    "url": {{ $.pub.url ? ('"' & $.pub.url & '"') ?? null }}
  },
  "actor": {{ $.user.id ? ('"' & $.user.id & '"') ?? null }},
  "context": null,
  "inReplyTo": null
}`,
										response: "json",
									},
								},
							],
						},
					},
				},
			},
			stageConnections: {
				Draft: {
					to: ["Published"],
				},
			},
			apiTokens: {
				allToken: {
					id: "11111111-1111-1111-1111-111111111111.yyyyyyyyyyyyyyyy",
				},
			},
		},
		{
			// this makes sure that the slug is `starter`, not `starter-${new Date().toISOString()}
			randomSlug: false,
		}
	)
}
