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
		ReviewCompleted: "dddddddd-0001-4ddd-dddd-dddddddddd12" as StagesId,
		AwaitingReview: "dddddddd-0001-4ddd-dddd-dddddddddd13" as StagesId,
		ReviewRejected: "dddddddd-0001-4ddd-dddd-dddddddddd14" as StagesId,
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
						"Offer Accepted": {
							icon: { name: "check", color: "#22c55e" },
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
										expression: "'Accept' in $.json.type",
									},
								],
							},
							resolver: `$.pub.id = {{ $replace($.json.inReplyTo, "urn:uuid:", "") }}`,
							actions: [
								{
									action: Action.email,
									config: {
										recipientEmail: "all@pubpub.org",
										subject:
											"Review offer accepted for: {{ $.pub.title }}",
										body: "The review offer for **{{ $.pub.title }}** has been accepted.\n\nView the submission: {{ $.env.PUBPUB_URL }}/c/{{ $.community.slug }}/pub/{{ $.pub.id }}",
									},
								},
								{
									action: Action.move,
									config: { stage: STAGE_IDS.AwaitingReview },
								},
							],
						},
						"Offer Rejected": {
							icon: { name: "x", color: "#ef4444" },
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
										expression: "'Reject' in $.json.type",
									},
								],
							},
							resolver: `$.pub.id = {{ $replace($.json.inReplyTo, "urn:uuid:", "") }}`,
							actions: [
								{
									action: Action.email,
									config: {
										recipientEmail: "all@pubpub.org",
										subject:
											"Review offer rejected for: {{ $.pub.title }}",
										body: "The review offer for **{{ $.pub.title }}** has been rejected.\n\nView the submission: {{ $.env.PUBPUB_URL }}/c/{{ $.community.slug }}/pub/{{ $.pub.id }}",
									},
								},
								{
									action: Action.move,
									config: { stage: STAGE_IDS.ReviewRejected },
								},
							],
						},
					},
				},
				AwaitingReview: {
					id: STAGE_IDS.AwaitingReview,
					automations: {
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
							resolver: "$.pub.id = {{ $replace($replace($.json.object.`as:inReplyTo`, $.env.PUBPUB_URL & \"/c/\" & $.community.slug & \"/pubs/\", \"\"), $.env.PUBPUB_URL & \"/c/\" & $.community.slug & \"/pub/\", \"\") }}",
							actions: [
								{
									action: Action.createPub,
									config: {
										stage: STAGE_IDS.ReviewCompleted,
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
				ReviewRejected: {
					id: STAGE_IDS.ReviewRejected,
					automations: {},
				},
				ReviewCompleted: {
					id: STAGE_IDS.ReviewCompleted,
					automations: {
						"Publish Site": {
							icon: { name: "globe", color: "#3b82f6" },
							triggers: [
								{ event: AutomationEvent.pubEnteredStage, config: {} },
							],
							actions: [
								{
									action: Action.buildSite,
									config: {
										subpath: "site",
										css: "* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: system-ui, -apple-system, sans-serif; background: #f0fdf4; color: #1e293b; line-height: 1.6; } .banner { background: #0d9488; color: #f0fdfa; padding: 0.5rem 1.5rem; font-size: 0.8rem; letter-spacing: 0.05em; text-transform: uppercase; } .site-content { max-width: 720px; margin: 2rem auto; padding: 0 1.5rem; } h1 { font-size: 1.6rem; color: #0f766e; border-bottom: 2px solid #14b8a6; padding-bottom: 0.5rem; margin-bottom: 1rem; } h2 { font-size: 1.1rem; color: #0f766e; margin: 1.25rem 0 0.4rem; } h3 { font-size: 1rem; margin: 0.75rem 0 0.25rem; } a { color: #0d9488; } .pub-field { margin-top: 1rem; } .pub-field-label { font-weight: 600; font-size: 0.85rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.5rem; } .pub-field-value { margin-bottom: 0.75rem; }",
										pages: [
											{
												filter: "$.pub.pubType.name = 'Submission'",
												slug: "$.pub.id",
												transform: [
													"'<article>'",
													"& '<h1>' & $.pub.title & '</h1>'",
													"& '<p>This paper presents a novel approach to distributed systems consensus, combining elements of classical Byzantine fault tolerance with modern machine learning techniques. We demonstrate that our method achieves significant improvements in throughput while maintaining strong consistency guarantees.</p>'",
													"& '<h2>Abstract</h2>'",
													"& '<p>Consensus protocols form the backbone of reliable distributed systems, yet existing approaches struggle to balance performance with correctness under adversarial conditions. In this work, we introduce Adaptive Consensus (AC), a protocol that dynamically adjusts its communication patterns based on observed network behavior. Our evaluation across geo-distributed deployments shows a 3.2x improvement in commit latency compared to state-of-the-art protocols, with no loss in safety guarantees.</p>'",
													"& '<h2>Introduction</h2>'",
													"& '<p>The proliferation of globally distributed applications has created renewed interest in consensus protocols that can operate efficiently across wide-area networks. Traditional protocols such as Paxos and Raft were designed primarily for local-area deployments, and their performance degrades significantly when participants are separated by high-latency links.</p>'",
													"& '<p>Recent work has explored various optimizations, including speculative execution, batching, and pipelining. However, these approaches typically assume relatively stable network conditions and do not adapt well to the dynamic environments characteristic of modern cloud deployments.</p>'",
													"& '</article>'",
												].join(" "),
												extension: "html",
											},
										// Review data group — not rendered as pages, used for cross-referencing
										{
											filter: "$.pub.pubType.name = 'Review'",
											slug: "'_data/' & $.pub.id",
											transform: "'{}'",
											extension: "json",
										},
										],
									},
								},
							],
						},
						"Notify: Site Published": {
							icon: { name: "mail", color: "#22c55e" },
							triggers: [
								{ event: AutomationEvent.pubEnteredStage, config: {} },
							],
							actions: [
								{
									action: Action.email,
									config: {
										recipientEmail: "all@pubpub.org",
										subject:
											"Site published with new review for: {{ $.pub.title }}",
										body: "The community site has been updated with a new review.\n\nReview: **{{ $.pub.title }}**\n\nView the pub: {{ $.env.PUBPUB_URL }}/c/{{ $.community.slug }}/pub/{{ $.pub.id }}\n\nView the site: http://localhost:9000/assets.v7.pubpub.org/sites/coar-us1-arcadia/site/index.html",
									},
								},
							],
						},
					},
				},
			},
			stageConnections: {
				Submissions: { to: ["AwaitingResponse"] },
				AwaitingResponse: { to: ["AwaitingReview", "ReviewRejected"] },
				AwaitingReview: { to: ["ReviewCompleted"] },
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
 * Flow: Receive Offer → Accept/Reject → Create Review → Review Workflow → Publish → Announce Review
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

	const SITE_BASE = "http://localhost:9000/assets.v7.pubpub.org/sites/coar-us2-unjournal/site"

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
								{
									action: Action.email,
									config: {
										recipientEmail: "all@pubpub.org",
										subject:
											"Review request accepted: {{ $.pub.title }}",
										body: "The review request **{{ $.pub.title }}** has been accepted.\n\nView: {{ $.env.PUBPUB_URL }}/c/{{ $.community.slug }}/pub/{{ $.pub.id }}",
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
											Content:
												"<p><strong>Summary:</strong> This paper presents a compelling approach to an important problem. The authors demonstrate a clear understanding of the existing literature and provide novel contributions that advance the field. We recommend acceptance with minor revisions.</p>" +
												"<p><strong>Strengths:</strong> The experimental design is rigorous and well-documented. The statistical analysis is appropriate, and the results are presented clearly. The discussion section effectively contextualizes the findings within the broader literature.</p>" +
												"<p><strong>Weaknesses:</strong> The sample size, while adequate, could be expanded in future work. Some of the assumptions underlying the theoretical model deserve further justification. The related work section would benefit from a more thorough comparison with recent approaches.</p>" +
												"<p><strong>Minor Issues:</strong> Figure 3 is difficult to read at the current resolution. Table 2 has a formatting inconsistency in the last column. A few typographical errors remain in Sections 4 and 5.</p>",
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
								{
									action: Action.email,
									config: {
										recipientEmail: "all@pubpub.org",
										subject:
											"Review request rejected: {{ $.pub.title }}",
										body: "The review request **{{ $.pub.title }}** has been rejected.\n\nView: {{ $.env.PUBPUB_URL }}/c/{{ $.community.slug }}/pub/{{ $.pub.id }}",
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
												"id": "${SITE_BASE}/" & $.pub.id & "/index.html",
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
						"Publish Site": {
							icon: { name: "globe", color: "#3b82f6" },
							triggers: [
								{ event: AutomationEvent.pubEnteredStage, config: {} },
							],
							actions: [
								{
									action: Action.buildSite,
									config: {
										subpath: "site",
										css: "* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: system-ui, -apple-system, sans-serif; background: #f0fdf4; color: #1e293b; line-height: 1.6; } .banner { background: #0d9488; color: #f0fdfa; padding: 0.5rem 1.5rem; font-size: 0.8rem; letter-spacing: 0.05em; text-transform: uppercase; } .site-content { max-width: 720px; margin: 2rem auto; padding: 0 1.5rem; } h1 { font-size: 1.6rem; color: #0f766e; border-bottom: 2px solid #14b8a6; padding-bottom: 0.5rem; margin-bottom: 1rem; } h2 { font-size: 1.1rem; color: #0f766e; margin: 1.25rem 0 0.4rem; } h3 { font-size: 1rem; margin: 0.75rem 0 0.25rem; } a { color: #0d9488; } .pub-field { margin-top: 1rem; } .pub-field-label { font-weight: 600; font-size: 0.85rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.5rem; } .pub-field-value { margin-bottom: 0.75rem; }",
										pages: [
										// Review HTML pages with signposting <link> to DocMap
										{
											filter: "$.pub.pubType.name = 'Review'",
											slug: "$.pub.id",
											transform: [
												"'<article>'",
												"& '<h1>' & $.pub.title & '</h1>'",
												"& '<div class=\"pub-field\">'",
												"& '<div class=\"pub-field-label\">Source</div>'",
												"& '<div class=\"pub-field-value\"><a href=\"' & $.pub.values.SourceURL & '\">' & $.pub.values.SourceURL & '</a></div>'",
												"& '</div>'",
												"& '</article>'"
											].join(" "),
											headExtra:
												"\"<link rel=describedby type=application/docmap+json href=http://localhost:9000/assets.v7.pubpub.org/sites/coar-us2-unjournal/site/\" & $.pub.id & \".docmap.json />\"",
											extension: "html",
										},
										// Isolated review content page
										{
											filter: "$.pub.pubType.name = 'Review'",
											slug: "$.pub.id & '/content'",
											transform:
												"$.pub.values.Content ? $.pub.values.Content : 'No content available'",
											extension: "html",
										},
										// DocMap JSON metadata for each review
										{
											filter: "$.pub.pubType.name = 'Review'",
											slug: "$.pub.id & '.docmap'",
											transform: [
												"$string({",
												"`@context`: \"https://w3id.org/docmaps/context.jsonld\",",
												"\"type\": \"docmap\",",
												"\"id\": \"http://localhost:9000/assets.v7.pubpub.org/sites/coar-us2-unjournal/site/\" & $.pub.id & \".docmap.json\",",
												"\"publisher\": {\"name\": $.community.name},",
												"`first-step`: \"_:b0\",",
												"\"steps\": {`_:b0`: {\"actions\": [{\"outputs\": [{",
												"\"type\": \"review-article\",",
												"\"content\": [",
												"{\"type\": \"web-page\", \"url\": \"http://localhost:9000/assets.v7.pubpub.org/sites/coar-us2-unjournal/site/\" & $.pub.id & \"/index.html\"},",
												"{\"type\": \"web-content\", \"url\": \"http://localhost:9000/assets.v7.pubpub.org/sites/coar-us2-unjournal/site/\" & $.pub.id & \"/content/index.html\"}",
												"]",
												"}]}]}}",
												"})"
											].join(" "),
											extension: "json",
										},
										],
									},
								},
							],
						},
						"Notify: Site Published": {
							icon: { name: "mail", color: "#22c55e" },
							triggers: [
								{ event: AutomationEvent.pubEnteredStage, config: {} },
							],
							actions: [
								{
									action: Action.email,
									config: {
										recipientEmail: "all@pubpub.org",
										subject:
											"Review published: {{ $.pub.title }}",
										body: `Review **{{ $.pub.title }}** has been published and announced.\n\nView the pub: {{ $.env.PUBPUB_URL }}/c/{{ $.community.slug }}/pub/{{ $.pub.id }}\n\nView the site: ${SITE_BASE}/index.html`,
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
 * Flow: Review → Publish → Build Site → Send Announce Review to Aggregator
 */
export async function seedCoarUS3(communityId?: CommunitiesId) {
	const STAGE_IDS = {
		Reviews: "dddddddd-0003-4ddd-dddd-dddddddddd10" as StagesId,
		Published: "dddddddd-0003-4ddd-dddd-dddddddddd11" as StagesId,
	}

	const SITE_BASE = "http://localhost:9000/assets.v7.pubpub.org/sites/coar-us3-review-group/site"

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
												"id": "${SITE_BASE}/" & $.pub.id & "/index.html",
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
						"Publish Site": {
							icon: { name: "globe", color: "#3b82f6" },
							triggers: [
								{ event: AutomationEvent.pubEnteredStage, config: {} },
							],
							actions: [
								{
									action: Action.buildSite,
									config: {
										subpath: "site",
										css: "* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: system-ui, -apple-system, sans-serif; background: #f0fdf4; color: #1e293b; line-height: 1.6; } .banner { background: #0d9488; color: #f0fdfa; padding: 0.5rem 1.5rem; font-size: 0.8rem; letter-spacing: 0.05em; text-transform: uppercase; } .site-content { max-width: 720px; margin: 2rem auto; padding: 0 1.5rem; } h1 { font-size: 1.6rem; color: #0f766e; border-bottom: 2px solid #14b8a6; padding-bottom: 0.5rem; margin-bottom: 1rem; } h2 { font-size: 1.1rem; color: #0f766e; margin: 1.25rem 0 0.4rem; } h3 { font-size: 1rem; margin: 0.75rem 0 0.25rem; } a { color: #0d9488; } .pub-field { margin-top: 1rem; } .pub-field-label { font-weight: 600; font-size: 0.85rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.5rem; } .pub-field-value { margin-bottom: 0.75rem; }",
										pages: [
										// Review HTML pages with signposting <link> to DocMap
										{
											filter: "$.pub.pubType.name = 'Review'",
											slug: "$.pub.id",
											transform: [
												"'<article>'",
												"& '<h1>' & $.pub.title & '</h1>'",
												"& '<div class=\"pub-field\">'",
												"& '<div class=\"pub-field-label\">Source</div>'",
												"& '<div class=\"pub-field-value\"><a href=\"' & $.pub.values.SourceURL & '\">' & $.pub.values.SourceURL & '</a></div>'",
												"& '</div>'",
												"& '</article>'"
											].join(" "),
											headExtra:
												"\"<link rel=describedby type=application/docmap+json href=http://localhost:9000/assets.v7.pubpub.org/sites/coar-us3-review-group/site/\" & $.pub.id & \".docmap.json />\"",
											extension: "html",
										},
										// Isolated review content page
										{
											filter: "$.pub.pubType.name = 'Review'",
											slug: "$.pub.id & '/content'",
											transform:
												"$.pub.values.Content ? $.pub.values.Content : 'No content available'",
											extension: "html",
										},
										// DocMap JSON metadata for each review
										{
											filter: "$.pub.pubType.name = 'Review'",
											slug: "$.pub.id & '.docmap'",
											transform: [
												"$string({",
												"`@context`: \"https://w3id.org/docmaps/context.jsonld\",",
												"\"type\": \"docmap\",",
												"\"id\": \"http://localhost:9000/assets.v7.pubpub.org/sites/coar-us3-review-group/site/\" & $.pub.id & \".docmap.json\",",
												"\"publisher\": {\"name\": $.community.name},",
												"`first-step`: \"_:b0\",",
												"\"steps\": {`_:b0`: {\"actions\": [{\"outputs\": [{",
												"\"type\": \"review-article\",",
												"\"content\": [",
												"{\"type\": \"web-page\", \"url\": \"http://localhost:9000/assets.v7.pubpub.org/sites/coar-us3-review-group/site/\" & $.pub.id & \"/index.html\"},",
												"{\"type\": \"web-content\", \"url\": \"http://localhost:9000/assets.v7.pubpub.org/sites/coar-us3-review-group/site/\" & $.pub.id & \"/content/index.html\"}",
												"]",
												"}]}]}}",
												"})"
											].join(" "),
											extension: "json",
										},
										],
									},
								},
							],
						},
						"Notify: Review Published": {
							icon: { name: "mail", color: "#22c55e" },
							triggers: [
								{ event: AutomationEvent.pubEnteredStage, config: {} },
							],
							actions: [
								{
									action: Action.email,
									config: {
										recipientEmail: "all@pubpub.org",
										subject:
											"Review published and announced: {{ $.pub.title }}",
										body: `Review **{{ $.pub.title }}** has been published and sent to the aggregator.\n\nView the pub: {{ $.env.PUBPUB_URL }}/c/{{ $.community.slug }}/pub/{{ $.pub.id }}\n\nView the site: ${SITE_BASE}/index.html`,
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
 * Flow: Receive Announce Ingest → Accept/Reject → Resolve Local Article → Create Linked Review → Build Site
 */
export async function seedCoarUS4(communityId?: CommunitiesId) {
	const STAGE_IDS = {
		Articles: "dddddddd-0004-4ddd-dddd-dddddddddd10" as StagesId,
		Inbox: "dddddddd-0004-4ddd-dddd-dddddddddd11" as StagesId,
		Accepted: "dddddddd-0004-4ddd-dddd-dddddddddd12" as StagesId,
		Rejected: "dddddddd-0004-4ddd-dddd-dddddddddd13" as StagesId,
		ReviewCompleted: "dddddddd-0004-4ddd-dddd-dddddddddd14" as StagesId,
	}

	const SITE_BASE = "http://localhost:9000/assets.v7.pubpub.org/sites/coar-us4-repository/site"

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
									action: Action.email,
									config: {
										recipientEmail: "all@pubpub.org",
										subject:
											"Ingest request accepted: {{ $.pub.title }}",
										body: "The ingest request **{{ $.pub.title }}** has been accepted.\n\nView: {{ $.env.PUBPUB_URL }}/c/{{ $.community.slug }}/pub/{{ $.pub.id }}",
									},
								},
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
									action: Action.email,
									config: {
										recipientEmail: "all@pubpub.org",
										subject:
											"Ingest request rejected: {{ $.pub.title }}",
										body: "The ingest request **{{ $.pub.title }}** has been rejected.\n\nView: {{ $.env.PUBPUB_URL }}/c/{{ $.community.slug }}/pub/{{ $.pub.id }}",
									},
								},
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
							resolver: "$.pub.id = {{ $replace($replace($eval($.pub.values.Payload).object.`as:inReplyTo`, $.env.PUBPUB_URL & \"/c/\" & $.community.slug & \"/pubs/\", \"\"), $.env.PUBPUB_URL & \"/c/\" & $.community.slug & \"/pub/\", \"\") }}",
							actions: [
								{
									action: Action.createPub,
									config: {
										stage: STAGE_IDS.ReviewCompleted,
										formSlug: "review-default-editor",
										pubValues: {
											Title: "Review from aggregator: {{ $eval($.pub.values.Payload).object.id }}",
											SourceURL: "{{ $eval($.pub.values.Payload).object.id }}",
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
				ReviewCompleted: {
					id: STAGE_IDS.ReviewCompleted,
					automations: {
						"Publish Site": {
							icon: { name: "globe", color: "#3b82f6" },
							triggers: [
								{ event: AutomationEvent.pubEnteredStage, config: {} },
							],
							actions: [
								{
									action: Action.buildSite,
									config: {
										subpath: "site",
										css: "* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: system-ui, -apple-system, sans-serif; background: #f0fdf4; color: #1e293b; line-height: 1.6; } .banner { background: #0d9488; color: #f0fdfa; padding: 0.5rem 1.5rem; font-size: 0.8rem; letter-spacing: 0.05em; text-transform: uppercase; } .site-content { max-width: 720px; margin: 2rem auto; padding: 0 1.5rem; } h1 { font-size: 1.6rem; color: #0f766e; border-bottom: 2px solid #14b8a6; padding-bottom: 0.5rem; margin-bottom: 1rem; } h2 { font-size: 1.1rem; color: #0f766e; margin: 1.25rem 0 0.4rem; } h3 { font-size: 1rem; margin: 0.75rem 0 0.25rem; } a { color: #0d9488; } .pub-field { margin-top: 1rem; } .pub-field-label { font-weight: 600; font-size: 0.85rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.5rem; } .pub-field-value { margin-bottom: 0.75rem; }",
										pages: [
											{
												filter: "$.pub.pubType.name = 'Submission'",
												slug: "$.pub.id",
												transform: [
													"'<article>'",
													"& '<h1>' & $.pub.title & '</h1>'",
													"& '<p>This paper presents a novel approach to distributed systems consensus, combining elements of classical Byzantine fault tolerance with modern machine learning techniques. We demonstrate that our method achieves significant improvements in throughput while maintaining strong consistency guarantees.</p>'",
													"& '<h2>Abstract</h2>'",
													"& '<p>Consensus protocols form the backbone of reliable distributed systems, yet existing approaches struggle to balance performance with correctness under adversarial conditions. In this work, we introduce Adaptive Consensus (AC), a protocol that dynamically adjusts its communication patterns based on observed network behavior. Our evaluation across geo-distributed deployments shows a 3.2x improvement in commit latency compared to state-of-the-art protocols, with no loss in safety guarantees.</p>'",
													"& '<h2>Introduction</h2>'",
													"& '<p>The proliferation of globally distributed applications has created renewed interest in consensus protocols that can operate efficiently across wide-area networks. Traditional protocols such as Paxos and Raft were designed primarily for local-area deployments, and their performance degrades significantly when participants are separated by high-latency links.</p>'",
													"& '<p>Recent work has explored various optimizations, including speculative execution, batching, and pipelining. However, these approaches typically assume relatively stable network conditions and do not adapt well to the dynamic environments characteristic of modern cloud deployments.</p>'",
													"& '</article>'",
												].join(" "),
												extension: "html",
											},
										// Review data group — not rendered as pages, used for cross-referencing
										{
											filter: "$.pub.pubType.name = 'Review'",
											slug: "'_data/' & $.pub.id",
											transform: "'{}'",
											extension: "json",
										},
										],
									},
								},
							],
						},
						"Notify: Site Published": {
							icon: { name: "mail", color: "#22c55e" },
							triggers: [
								{ event: AutomationEvent.pubEnteredStage, config: {} },
							],
							actions: [
								{
									action: Action.email,
									config: {
										recipientEmail: "all@pubpub.org",
										subject:
											"Site published with new review: {{ $.pub.title }}",
										body: `The community site has been updated with a new review.\n\nReview: **{{ $.pub.title }}**\n\nView the pub: {{ $.env.PUBPUB_URL }}/c/{{ $.community.slug }}/pub/{{ $.pub.id }}\n\nView the site: ${SITE_BASE}/index.html`,
									},
								},
							],
						},
					},
				},
			},
			stageConnections: {
				Inbox: { to: ["Accepted", "Rejected"] },
				Accepted: { to: ["ReviewCompleted"] },
			},
		},
		{ randomSlug: false }
	)
}
