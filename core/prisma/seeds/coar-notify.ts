import type { CommunitiesId, StagesId, UsersId } from "db/public"

import {
	Action,
	AutomationConditionBlockType,
	AutomationEvent,
	CoreSchemaType,
	MemberRole,
} from "db/public"

import { env } from "~/lib/env/env"
import { seedCommunity } from "../seed/seedCommunity"

const WEBHOOK_PATH = "coar-inbox"
const REMOTE_INBOX_URL = "http://localhost:4001/api/inbox"

const adminId = "dddddddd-dddd-4ddd-dddd-dddddddddd01" as UsersId
const joeAuthorId = "dddddddd-dddd-4ddd-dddd-dddddddddd02" as UsersId

/**
 * User Story 1: Repository Author Requests Review
 *
 * Arcadia Science is a PubPub repository community. An author can request
 * a review from an external service like PreReview. When the review is
 * fulfilled, a link to it appears alongside the research output.
 *
 * Flow: Submission → Request Review → Send Offer → Receive Announce Review → Display Review
 */
export async function seedCoarUS1(communityId?: CommunitiesId) {
	const STAGE_IDS = {
		Submissions: "dddddddd-0001-4ddd-dddd-dddddddddd10" as StagesId,
		AwaitingResponse: "dddddddd-0001-4ddd-dddd-dddddddddd11" as StagesId,
		Completed: "dddddddd-0001-4ddd-dddd-dddddddddd12" as StagesId,
	}

	return seedCommunity(
		{
			community: {
				id: communityId,
				name: "US1: Arcadia Science",
				slug: "coar-us1-arcadia",
				avatar: `${env.PUBPUB_URL}/demo/croc.png`,
			},
			pubFields: {
				Title: { schemaName: CoreSchemaType.String },
				Content: { schemaName: CoreSchemaType.String },
				Author: { schemaName: CoreSchemaType.MemberId },
				SourceURL: { schemaName: CoreSchemaType.String },
				RelatedPub: { schemaName: CoreSchemaType.String, relation: true },
			},
			pubTypes: {
				Submission: {
					Title: { isTitle: true },
					Content: { isTitle: false },
					Author: { isTitle: false },
				},
				Review: {
					Title: { isTitle: true },
					Content: { isTitle: false },
					RelatedPub: { isTitle: false },
					SourceURL: { isTitle: false },
				},
			},
			users: {
				admin: {
					id: adminId,
					firstName: "COAR",
					lastName: "Admin",
					email: "coar-admin@pubpub.org",
					password: "pubpub-coar",
					role: MemberRole.admin,
				},
				jillAdmin: {
					id: "0cd4b908-b4f6-41be-9463-28979fefb4cd" as UsersId,
					existing: true,
					role: MemberRole.admin,
				},
				joeAuthor: {
					id: joeAuthorId,
					firstName: "Joe",
					lastName: "Author",
					email: "joe-author@pubpub.org",
					password: "pubpub-joe",
					role: MemberRole.contributor,
				},
			},
			pubs: [
				{
					pubType: "Submission",
					stage: "Submissions",
					values: {
						Title: "Sample Paper for Review",
						Author: joeAuthorId,
					},
				},
			],
			stages: {
				Submissions: {
					id: STAGE_IDS.Submissions,
					automations: {
						"Request Review": {
							icon: { name: "send", color: "#f59e0b" },
							triggers: [{ event: AutomationEvent.manual, config: {} }],
							condition: {
								type: AutomationConditionBlockType.AND,
								items: [
									{
										kind: "condition",
										type: "jsonata",
										expression: "$.pub.pubType.name = 'Submission'",
									},
								],
							},
							actions: [
								{
									action: Action.move,
									config: { stage: STAGE_IDS.AwaitingResponse },
								},
							],
						},
					},
				},
				AwaitingResponse: {
					id: STAGE_IDS.AwaitingResponse,
					automations: {
						"Send Review Offer": {
							icon: { name: "send", color: "#f59e0b" },
							triggers: [
								{ event: AutomationEvent.pubEnteredStage, config: {} },
							],
							condition: {
								type: AutomationConditionBlockType.AND,
								items: [
									{
										kind: "condition",
										type: "jsonata",
										expression: "$.pub.pubType.name = 'Submission'",
									},
								],
							},
							actions: [
								{
									action: Action.http,
									config: {
										url: REMOTE_INBOX_URL,
										method: "POST",
										body: `<<< {
											"@context": [
												"https://www.w3.org/ns/activitystreams",
												"https://coar-notify.net"
											],
											"type": ["Offer", "coar-notify:ReviewAction"],
											"id": "urn:uuid:" & $.pub.id,
											"actor": {
												"id": $.env.PUBPUB_URL & "/c/" & $.community.slug,
												"type": "Service",
												"name": $.community.name
											},
											"object": {
												"id": $.env.PUBPUB_URL & "/c/" & $.community.slug & "/pub/" & $.pub.id,
												"type": ["Page", "sorg:AboutPage"]
											},
											"target": {
												"id": "${REMOTE_INBOX_URL.replace("/inbox", "")}",
												"inbox": "${REMOTE_INBOX_URL}",
												"type": "Service"
											},
											"origin": {
												"id": $.env.PUBPUB_URL & "/c/" & $.community.slug,
												"inbox": $.env.PUBPUB_URL & "/api/v0/c/" & $.community.slug & "/site/webhook/${WEBHOOK_PATH}",
												"type": "Service"
											}
										} >>>`,
									},
								},
							],
						},
						"Receive Review Announcement": {
							icon: { name: "mail", color: "#3b82f6" },
							triggers: [
								{
									event: AutomationEvent.webhook,
									config: { path: WEBHOOK_PATH },
								},
							],
							condition: {
								type: AutomationConditionBlockType.AND,
								items: [
									{
										kind: "condition",
										type: "jsonata",
										expression:
											"'Announce' in $.json.type and 'coar-notify:ReviewAction' in $.json.type",
									},
								],
							},
							resolver: `$.pub.id = {{ $replace($replace($.json.object["as:inReplyTo"], $.env.PUBPUB_URL & "/c/" & $.community.slug & "/pubs/", ""), $.env.PUBPUB_URL & "/c/" & $.community.slug & "/pub/", "") }}`,
							actions: [
								{
									action: Action.createPub,
									config: {
										stage: STAGE_IDS.Completed,
										formSlug: "review-default-editor",
										pubValues: {
											Title: "Review: {{ $.json.object.id }}",
											SourceURL: "{{ $.json.object.id }}",
										},
										relationConfig: {
											fieldSlug: "coar-us1-arcadia:relatedpub",
											relatedPubId: "{{ $.pub.id }}",
											value: "Submission",
											direction: "source",
										},
									},
								},
							],
						},
					},
				},
				Completed: {
					id: STAGE_IDS.Completed,
					automations: {},
				},
			},
			stageConnections: {
				Submissions: { to: ["AwaitingResponse"] },
			},
		},
		{ randomSlug: false }
	)
}

/**
 * User Story 2: Review Group Receives Review Request
 *
 * The Unjournal is a PubPub review group community. It receives review
 * requests from external repositories, processes them through a review
 * workflow, and announces the completed review back to the repository.
 *
 * Flow: Receive Offer → Accept/Reject → Create Review → Review Workflow → Announce Review
 */
export async function seedCoarUS2(communityId?: CommunitiesId) {
	const STAGE_IDS = {
		Inbox: "dddddddd-0002-4ddd-dddd-dddddddddd10" as StagesId,
		Accepted: "dddddddd-0002-4ddd-dddd-dddddddddd11" as StagesId,
		Rejected: "dddddddd-0002-4ddd-dddd-dddddddddd12" as StagesId,
		ReviewInbox: "dddddddd-0002-4ddd-dddd-dddddddddd13" as StagesId,
		Reviewing: "dddddddd-0002-4ddd-dddd-dddddddddd14" as StagesId,
		Published: "dddddddd-0002-4ddd-dddd-dddddddddd15" as StagesId,
	}

	return seedCommunity(
		{
			community: {
				id: communityId,
				name: "US2: The Unjournal",
				slug: "coar-us2-unjournal",
				avatar: `${env.PUBPUB_URL}/demo/croc.png`,
			},
			pubFields: {
				Title: { schemaName: CoreSchemaType.String },
				Content: { schemaName: CoreSchemaType.String },
				Payload: { schemaName: CoreSchemaType.String },
				SourceURL: { schemaName: CoreSchemaType.String },
				RelatedPub: { schemaName: CoreSchemaType.String, relation: true },
			},
			pubTypes: {
				Notification: {
					Title: { isTitle: true },
					Payload: { isTitle: false },
					SourceURL: { isTitle: false },
					RelatedPub: { isTitle: false },
				},
				Review: {
					Title: { isTitle: true },
					Content: { isTitle: false },
					RelatedPub: { isTitle: false },
					SourceURL: { isTitle: false },
				},
			},
			users: {
				admin: {
					id: adminId,
					existing: true,
					role: MemberRole.admin,
				},
				jillAdmin: {
					id: "0cd4b908-b4f6-41be-9463-28979fefb4cd" as UsersId,
					existing: true,
					role: MemberRole.admin,
				},
			},
			stages: {
				Inbox: {
					id: STAGE_IDS.Inbox,
					automations: {
						"Process COAR Notification": {
							icon: { name: "mail", color: "#3b82f6" },
							triggers: [
								{
									event: AutomationEvent.webhook,
									config: { path: WEBHOOK_PATH },
								},
							],
							condition: {
								type: AutomationConditionBlockType.AND,
								items: [
									{
										kind: "condition",
										type: "jsonata",
										expression: "'Offer' in $.json.type",
									},
								],
							},
							actions: [
								{
									action: Action.createPub,
									config: {
										stage: STAGE_IDS.Inbox,
										formSlug: "notification-default-editor",
										pubValues: {
											Title: "URL: {{ $.json.object.id }} - Type: {{ $join($.json.type, ', ') }}",
											Payload: "{{ $string($.json) }}",
											SourceURL: "{{ $.json.object.id }}",
										},
									},
								},
							],
						},
						"Accept Request": {
							icon: { name: "check", color: "#22c55e" },
							triggers: [{ event: AutomationEvent.manual, config: {} }],
							condition: {
								type: AutomationConditionBlockType.AND,
								items: [
									{
										kind: "condition",
										type: "jsonata",
										expression: "$.pub.pubType.name = 'Notification'",
									},
								],
							},
							actions: [
								{
									action: Action.move,
									config: { stage: STAGE_IDS.Accepted },
								},
							],
						},
						"Reject Request": {
							icon: { name: "x", color: "#ef4444" },
							triggers: [{ event: AutomationEvent.manual, config: {} }],
							condition: {
								type: AutomationConditionBlockType.AND,
								items: [
									{
										kind: "condition",
										type: "jsonata",
										expression: "$.pub.pubType.name = 'Notification'",
									},
								],
							},
							actions: [
								{
									action: Action.move,
									config: { stage: STAGE_IDS.Rejected },
								},
							],
						},
					},
				},
				Accepted: {
					id: STAGE_IDS.Accepted,
					automations: {
						"Send Accept Acknowledgement": {
							icon: { name: "check", color: "#22c55e" },
							triggers: [
								{ event: AutomationEvent.pubEnteredStage, config: {} },
							],
							condition: {
								type: AutomationConditionBlockType.AND,
								items: [
									{
										kind: "condition",
										type: "jsonata",
										expression: "$.pub.pubType.name = 'Notification'",
									},
								],
							},
							actions: [
								{
									action: Action.http,
									config: {
										url: REMOTE_INBOX_URL,
										method: "POST",
										body: `<<< (
											$payload := $eval($.pub.values.Payload);
											{
												"@context": [
													"https://www.w3.org/ns/activitystreams",
													"https://coar-notify.net"
												],
												"type": "Accept",
												"id": "urn:uuid:" & $.pub.id & ":accept",
												"actor": {
													"id": $.env.PUBPUB_URL & "/c/" & $.community.slug,
													"type": "Service",
													"name": $.community.name
												},
												"inReplyTo": $payload.id,
												"object": $payload.object,
												"origin": {
													"id": $.env.PUBPUB_URL & "/c/" & $.community.slug,
													"inbox": $.env.PUBPUB_URL & "/api/v0/c/" & $.community.slug & "/site/webhook/${WEBHOOK_PATH}",
													"type": "Service"
												},
												"target": $payload.actor
											}
										) >>>`,
									},
								},
							],
						},
						"Create Review for Offer": {
							icon: { name: "plus-circle", color: "#10b981" },
							triggers: [
								{ event: AutomationEvent.pubEnteredStage, config: {} },
							],
							condition: {
								type: AutomationConditionBlockType.AND,
								items: [
									{
										kind: "condition",
										type: "jsonata",
										expression: "$.pub.pubType.name = 'Notification'",
									},
									{
										kind: "condition",
										type: "jsonata",
										expression:
											"'Offer' in $eval($.pub.values.Payload).type",
									},
								],
							},
							actions: [
								{
									action: Action.createPub,
									config: {
										stage: STAGE_IDS.ReviewInbox,
										formSlug: "review-default-editor",
										pubValues: {
											Title: "Review for: {{ $.pub.values.title }}",
											SourceURL: "{{ $.pub.values.SourceURL }}",
										},
										relationConfig: {
											fieldSlug: "coar-us2-unjournal:relatedpub",
											relatedPubId: "{{ $.pub.id }}",
											value: "Notification",
											direction: "source",
										},
									},
								},
							],
						},
					},
				},
				Rejected: {
					id: STAGE_IDS.Rejected,
					automations: {
						"Send Reject Acknowledgement": {
							icon: { name: "x", color: "#ef4444" },
							triggers: [
								{ event: AutomationEvent.pubEnteredStage, config: {} },
							],
							condition: {
								type: AutomationConditionBlockType.AND,
								items: [
									{
										kind: "condition",
										type: "jsonata",
										expression: "$.pub.pubType.name = 'Notification'",
									},
								],
							},
							actions: [
								{
									action: Action.http,
									config: {
										url: REMOTE_INBOX_URL,
										method: "POST",
										body: `<<< (
											$payload := $eval($.pub.values.Payload);
											{
												"@context": [
													"https://www.w3.org/ns/activitystreams",
													"https://coar-notify.net"
												],
												"type": "Reject",
												"id": "urn:uuid:" & $.pub.id & ":reject",
												"actor": {
													"id": $.env.PUBPUB_URL & "/c/" & $.community.slug,
													"type": "Service",
													"name": $.community.name
												},
												"inReplyTo": $payload.id,
												"object": $payload.object,
												"origin": {
													"id": $.env.PUBPUB_URL & "/c/" & $.community.slug,
													"inbox": $.env.PUBPUB_URL & "/api/v0/c/" & $.community.slug & "/site/webhook/${WEBHOOK_PATH}",
													"type": "Service"
												},
												"target": $payload.actor,
												"summary": "The review request was rejected."
											}
										) >>>`,
									},
								},
							],
						},
					},
				},
				ReviewInbox: {
					id: STAGE_IDS.ReviewInbox,
					automations: {
						"Start Review": {
							icon: { name: "play", color: "#8b5cf6" },
							triggers: [
								{ event: AutomationEvent.pubEnteredStage, config: {} },
							],
							actions: [
								{
									action: Action.move,
									config: { stage: STAGE_IDS.Reviewing },
								},
							],
						},
					},
				},
				Reviewing: {
					id: STAGE_IDS.Reviewing,
					automations: {
						"Finish Review": {
							icon: { name: "check-circle", color: "#22c55e" },
							triggers: [
								{ event: AutomationEvent.pubEnteredStage, config: {} },
							],
							actions: [
								{
									action: Action.move,
									config: { stage: STAGE_IDS.Published },
								},
							],
						},
					},
				},
				Published: {
					id: STAGE_IDS.Published,
					automations: {
						"Announce Review": {
							icon: { name: "send", color: "#ec4899" },
							triggers: [
								{ event: AutomationEvent.pubEnteredStage, config: {} },
							],
							actions: [
								{
									action: Action.http,
									config: {
										url: REMOTE_INBOX_URL,
										method: "POST",
										body: `<<< {
											"@context": [
												"https://www.w3.org/ns/activitystreams",
												"https://coar-notify.net"
											],
											"type": ["Announce", "coar-notify:ReviewAction"],
											"id": "urn:uuid:" & $.pub.id,
											"object": {
												"id": $.env.PUBPUB_URL & "/c/" & $.community.slug & "/pub/" & $.pub.id,
												"type": ["Page", "sorg:Review"],
												"as:inReplyTo": $.pub.out.RelatedPub.values.SourceURL
											},
											"target": {
												"id": "${REMOTE_INBOX_URL.replace("/inbox", "")}",
												"inbox": "${REMOTE_INBOX_URL}",
												"type": "Service"
											}
										} >>>`,
									},
								},
							],
						},
					},
				},
			},
			stageConnections: {
				Inbox: { to: ["Accepted", "Rejected"] },
				Accepted: { to: ["ReviewInbox"] },
				ReviewInbox: { to: ["Reviewing"] },
				Reviewing: { to: ["Published"] },
			},
		},
		{ randomSlug: false }
	)
}

/**
 * User Story 3: Review Group Requests Ingestion By Aggregator
 *
 * A review group (e.g. The Unjournal) has produced a review and wants to
 * notify an aggregator like Sciety to ingest it. When a review is published,
 * it sends a Request Ingest notification to the aggregator.
 *
 * Flow: Review → Publish → Send Announce Review to Aggregator
 */
export async function seedCoarUS3(communityId?: CommunitiesId) {
	const STAGE_IDS = {
		Reviews: "dddddddd-0003-4ddd-dddd-dddddddddd10" as StagesId,
		Published: "dddddddd-0003-4ddd-dddd-dddddddddd11" as StagesId,
	}

	return seedCommunity(
		{
			community: {
				id: communityId,
				name: "US3: Review Group",
				slug: "coar-us3-review-group",
				avatar: `${env.PUBPUB_URL}/demo/croc.png`,
			},
			pubFields: {
				Title: { schemaName: CoreSchemaType.String },
				Content: { schemaName: CoreSchemaType.String },
				SourceURL: { schemaName: CoreSchemaType.String },
			},
			pubTypes: {
				Review: {
					Title: { isTitle: true },
					Content: { isTitle: false },
					SourceURL: { isTitle: false },
				},
			},
			users: {
				admin: {
					id: adminId,
					existing: true,
					role: MemberRole.admin,
				},
				jillAdmin: {
					id: "0cd4b908-b4f6-41be-9463-28979fefb4cd" as UsersId,
					existing: true,
					role: MemberRole.admin,
				},
			},
			pubs: [
				{
					pubType: "Review",
					stage: "Reviews",
					values: {
						Title: "Sample Review of Research Output",
						SourceURL: "https://www.biorxiv.org/content/10.1101/2024.01.01.123456",
					},
				},
			],
			stages: {
				Reviews: {
					id: STAGE_IDS.Reviews,
					automations: {
						"Publish Review": {
							icon: { name: "check-circle", color: "#22c55e" },
							triggers: [{ event: AutomationEvent.manual, config: {} }],
							condition: {
								type: AutomationConditionBlockType.AND,
								items: [
									{
										kind: "condition",
										type: "jsonata",
										expression: "$.pub.pubType.name = 'Review'",
									},
								],
							},
							actions: [
								{
									action: Action.move,
									config: { stage: STAGE_IDS.Published },
								},
							],
						},
					},
				},
				Published: {
					id: STAGE_IDS.Published,
					automations: {
						"Request Ingest": {
							icon: { name: "send", color: "#ec4899" },
							triggers: [
								{ event: AutomationEvent.pubEnteredStage, config: {} },
							],
							actions: [
								{
									action: Action.http,
									config: {
										url: REMOTE_INBOX_URL,
										method: "POST",
										body: `<<< {
											"@context": [
												"https://www.w3.org/ns/activitystreams",
												"https://coar-notify.net"
											],
											"type": ["Announce", "coar-notify:ReviewAction"],
											"id": "urn:uuid:" & $.pub.id,
											"object": {
												"id": $.env.PUBPUB_URL & "/c/" & $.community.slug & "/pub/" & $.pub.id,
												"type": ["Page", "sorg:Review"],
												"as:inReplyTo": $.pub.values.SourceURL
											},
											"target": {
												"id": "${REMOTE_INBOX_URL.replace("/inbox", "")}",
												"inbox": "${REMOTE_INBOX_URL}",
												"type": "Service"
											}
										} >>>`,
									},
								},
							],
						},
					},
				},
			},
			stageConnections: {
				Reviews: { to: ["Published"] },
			},
		},
		{ randomSlug: false }
	)
}

/**
 * User Story 4: Review Group Aggregation Announcement to Repositories
 *
 * Arcadia Science (or any PubPub repository) subscribes to review notifications
 * from an aggregator like Sciety. When an Announce Ingest arrives, the admin can
 * accept it, which resolves the local article and creates a linked Review.
 *
 * Flow: Receive Announce Ingest → Accept/Reject → Resolve Local Article → Create Linked Review
 */
export async function seedCoarUS4(communityId?: CommunitiesId) {
	const STAGE_IDS = {
		Articles: "dddddddd-0004-4ddd-dddd-dddddddddd10" as StagesId,
		Inbox: "dddddddd-0004-4ddd-dddd-dddddddddd11" as StagesId,
		Accepted: "dddddddd-0004-4ddd-dddd-dddddddddd12" as StagesId,
		Rejected: "dddddddd-0004-4ddd-dddd-dddddddddd13" as StagesId,
		ReviewInbox: "dddddddd-0004-4ddd-dddd-dddddddddd14" as StagesId,
	}

	return seedCommunity(
		{
			community: {
				id: communityId,
				name: "US4: Arcadia Science",
				slug: "coar-us4-repository",
				avatar: `${env.PUBPUB_URL}/demo/croc.png`,
			},
			pubFields: {
				Title: { schemaName: CoreSchemaType.String },
				Content: { schemaName: CoreSchemaType.String },
				Payload: { schemaName: CoreSchemaType.String },
				SourceURL: { schemaName: CoreSchemaType.String },
				RelatedPub: { schemaName: CoreSchemaType.String, relation: true },
			},
			pubTypes: {
				Submission: {
					Title: { isTitle: true },
					Content: { isTitle: false },
				},
				Notification: {
					Title: { isTitle: true },
					Payload: { isTitle: false },
					SourceURL: { isTitle: false },
					RelatedPub: { isTitle: false },
				},
				Review: {
					Title: { isTitle: true },
					Content: { isTitle: false },
					RelatedPub: { isTitle: false },
				},
			},
			users: {
				admin: {
					id: adminId,
					existing: true,
					role: MemberRole.admin,
				},
				jillAdmin: {
					id: "0cd4b908-b4f6-41be-9463-28979fefb4cd" as UsersId,
					existing: true,
					role: MemberRole.admin,
				},
			},
			pubs: [
				{
					pubType: "Submission",
					stage: "Articles",
					values: {
						Title: "Research Paper on Gene Expression",
					},
				},
			],
			stages: {
				Articles: {
					id: STAGE_IDS.Articles,
					automations: {},
				},
				Inbox: {
					id: STAGE_IDS.Inbox,
					automations: {
						"Process COAR Notification": {
							icon: { name: "mail", color: "#3b82f6" },
							triggers: [
								{
									event: AutomationEvent.webhook,
									config: { path: WEBHOOK_PATH },
								},
							],
							condition: {
								type: AutomationConditionBlockType.AND,
								items: [
									{
										kind: "condition",
										type: "jsonata",
										expression:
											"'Announce' in $.json.type and 'coar-notify:IngestAction' in $.json.type",
									},
								],
							},
							actions: [
								{
									action: Action.createPub,
									config: {
										stage: STAGE_IDS.Inbox,
										formSlug: "notification-default-editor",
										pubValues: {
											Title: "URL: {{ $.json.object.id }} - Type: {{ $join($.json.type, ', ') }}",
											Payload: "{{ $string($.json) }}",
											SourceURL: "{{ $.json.object.id }}",
										},
									},
								},
							],
						},
						"Accept Request": {
							icon: { name: "check", color: "#22c55e" },
							triggers: [{ event: AutomationEvent.manual, config: {} }],
							condition: {
								type: AutomationConditionBlockType.AND,
								items: [
									{
										kind: "condition",
										type: "jsonata",
										expression: "$.pub.pubType.name = 'Notification'",
									},
								],
							},
							actions: [
								{
									action: Action.move,
									config: { stage: STAGE_IDS.Accepted },
								},
							],
						},
						"Reject Request": {
							icon: { name: "x", color: "#ef4444" },
							triggers: [{ event: AutomationEvent.manual, config: {} }],
							condition: {
								type: AutomationConditionBlockType.AND,
								items: [
									{
										kind: "condition",
										type: "jsonata",
										expression: "$.pub.pubType.name = 'Notification'",
									},
								],
							},
							actions: [
								{
									action: Action.move,
									config: { stage: STAGE_IDS.Rejected },
								},
							],
						},
					},
				},
				Accepted: {
					id: STAGE_IDS.Accepted,
					automations: {
						"Create Review for Ingest": {
							icon: { name: "plus-circle", color: "#10b981" },
							triggers: [
								{ event: AutomationEvent.pubEnteredStage, config: {} },
							],
							condition: {
								type: AutomationConditionBlockType.AND,
								items: [
									{
										kind: "condition",
										type: "jsonata",
										expression: "$.pub.pubType.name = 'Notification'",
									},
									{
										kind: "condition",
										type: "jsonata",
										expression:
											"'Announce' in $eval($.pub.values.Payload).type and 'coar-notify:IngestAction' in $eval($.pub.values.Payload).type",
									},
								],
							},
							resolver: `$.pub.id = {{ $replace($replace($eval($.pub.values.Payload).object["as:inReplyTo"], $.env.PUBPUB_URL & "/c/" & $.community.slug & "/pubs/", ""), $.env.PUBPUB_URL & "/c/" & $.community.slug & "/pub/", "") }}`,
							actions: [
								{
									action: Action.createPub,
									config: {
										stage: STAGE_IDS.ReviewInbox,
										formSlug: "review-default-editor",
										pubValues: {
											Title: "Review from aggregator: {{ $eval($.pub.values.Payload).object.id }}",
										},
										relationConfig: {
											fieldSlug: "coar-us4-repository:relatedpub",
											relatedPubId: "{{ $.pub.id }}",
											value: "Submission",
											direction: "source",
										},
									},
								},
							],
						},
					},
				},
				Rejected: {
					id: STAGE_IDS.Rejected,
					automations: {},
				},
				ReviewInbox: {
					id: STAGE_IDS.ReviewInbox,
					automations: {},
				},
			},
			stageConnections: {
				Inbox: { to: ["Accepted", "Rejected"] },
				Accepted: { to: ["ReviewInbox"] },
			},
		},
		{ randomSlug: false }
	)
}
