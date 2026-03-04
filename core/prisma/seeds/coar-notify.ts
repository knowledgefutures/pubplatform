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

export async function seedCoarNotify(communityId?: CommunitiesId) {
	const adminId = "dddddddd-dddd-4ddd-dddd-dddddddddd01" as UsersId

	const STAGE_IDS = {
		// Incoming notification processing stages
		Inbox: "dddddddd-dddd-4ddd-dddd-dddddddddd10" as StagesId,
		Accepted: "dddddddd-dddd-4ddd-dddd-dddddddddd12" as StagesId,
		Rejected: "dddddddd-dddd-4ddd-dddd-dddddddddd13" as StagesId,
		// Review workflow stages (for Reviews created from Notifications)
		ReviewInbox: "dddddddd-dddd-4ddd-dddd-dddddddddd15" as StagesId,
		Reviewing: "dddddddd-dddd-4ddd-dddd-dddddddddd16" as StagesId,
		Published: "dddddddd-dddd-4ddd-dddd-dddddddddd14" as StagesId,
		// Outbound review request stages (for our Submissions)
		Submissions: "dddddddd-dddd-4ddd-dddd-dddddddddd17" as StagesId,
		AwaitingResponse: "dddddddd-dddd-4ddd-dddd-dddddddddd18" as StagesId,
	}

	const WEBHOOK_PATH = "coar-inbox"

	// Default remote inbox URL - can be changed in UI for testing
	const REMOTE_INBOX_URL = "http://localhost:4001/api/inbox"

	return seedCommunity(
		{
			community: {
				id: communityId,
				name: "COAR Notify",
				slug: "coar-notify",
				avatar: `${env.PUBPUB_URL}/demo/croc.png`,
			},
			pubFields: {
				Title: { schemaName: CoreSchemaType.String },
				Content: { schemaName: CoreSchemaType.String },
				Payload: { schemaName: CoreSchemaType.String },
				SourceURL: { schemaName: CoreSchemaType.String },
				RelatedPub: { schemaName: CoreSchemaType.String, relation: true },
				Author: { schemaName: CoreSchemaType.MemberId },
			},
			pubTypes: {
				Submission: {
					Title: { isTitle: true },
					Content: { isTitle: false },
					Author: { isTitle: false },
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
					id: "dddddddd-dddd-4ddd-dddd-dddddddddd02" as UsersId,
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
						Title: "Sample Submission for Review",
						Author: "dddddddd-dddd-4ddd-dddd-dddddddddd02",
					},
				},
			],
			stages: {
				Inbox: {
					id: STAGE_IDS.Inbox,
					automations: {
						"Process COAR Notification": {
							icon: {
								name: "mail",
								color: "#3b82f6",
							},
							triggers: [
								{
									event: AutomationEvent.webhook,
									config: { path: WEBHOOK_PATH },
								},
							],
							// Process incoming Offer (review requests) or Announce Ingest (aggregator notifications)
							condition: {
								type: AutomationConditionBlockType.AND,
								items: [
									{
										kind: "condition",
										type: "jsonata",
										expression:
											"'Offer' in $.json.type or ('Announce' in $.json.type and 'coar-notify:IngestAction' in $.json.type)",
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
						// Manual action to accept an incoming review request
						"Accept Request": {
							icon: {
								name: "check",
								color: "#22c55e",
							},
							triggers: [
								{
									event: AutomationEvent.manual,
									config: {},
								},
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
									action: Action.move,
									config: { stage: STAGE_IDS.Accepted },
								},
							],
						},
						// Manual action to reject an incoming review request
						"Reject Request": {
							icon: {
								name: "x",
								color: "#ef4444",
							},
							triggers: [
								{
									event: AutomationEvent.manual,
									config: {},
								},
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
									action: Action.move,
									config: { stage: STAGE_IDS.Rejected },
								},
							],
						},
					},
				},
				ReviewInbox: {
					id: STAGE_IDS.ReviewInbox,
					automations: {
						"Start Review": {
							icon: {
								name: "play",
								color: "#8b5cf6",
							},
							triggers: [{ event: AutomationEvent.pubEnteredStage, config: {} }],
							actions: [
								{ action: Action.move, config: { stage: STAGE_IDS.Reviewing } },
							],
						},
					},
				},
				Reviewing: {
					id: STAGE_IDS.Reviewing,
					automations: {
						"Finish Review": {
							icon: {
								name: "check-circle",
								color: "#22c55e",
							},
							triggers: [{ event: AutomationEvent.pubEnteredStage, config: {} }],
							actions: [
								{ action: Action.move, config: { stage: STAGE_IDS.Published } },
							],
						},
					},
				},
				// Entry point for our own submissions that we want to request reviews for
				Submissions: {
					id: STAGE_IDS.Submissions,
					automations: {
						// Manual action to request a review from a remote repository
						"Request Review": {
							icon: {
								name: "send",
								color: "#f59e0b",
							},
							triggers: [
								{
									event: AutomationEvent.manual,
									config: {},
								},
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
									action: Action.move,
									config: { stage: STAGE_IDS.AwaitingResponse },
								},
							],
						},
					},
				},
				// Waiting for response from external service after requesting a review
				AwaitingResponse: {
					id: STAGE_IDS.AwaitingResponse,
					automations: {
						// Send the Offer when a submission enters this stage
						"Send Review Offer": {
							icon: {
								name: "send",
								color: "#f59e0b",
							},
							triggers: [
								{
									event: AutomationEvent.pubEnteredStage,
									config: {},
								},
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
										body: {
											"@context": [
												"https://www.w3.org/ns/activitystreams",
												"https://coar-notify.net",
											],
											type: ["Offer", "coar-notify:ReviewAction"],
											id: "urn:uuid:{{ $.pub.id }}",
											actor: {
												id: "{{ $.env.PUBPUB_URL }}/c/{{ $.community.slug }}",
												type: "Service",
												name: "{{ $.community.name }}",
											},
											object: {
												id: "{{ $.env.PUBPUB_URL }}/c/{{ $.community.slug }}/pub/{{ $.pub.id }}",
												type: ["Page", "sorg:AboutPage"],
											},
											target: {
												id: REMOTE_INBOX_URL.replace("/inbox", ""),
												inbox: REMOTE_INBOX_URL,
												type: "Service",
											},
											origin: {
												id: "{{ $.env.PUBPUB_URL }}/c/{{ $.community.slug }}",
												inbox: `{{ $.env.PUBPUB_URL }}/api/v0/c/{{ $.community.slug }}/site/webhook/${WEBHOOK_PATH}`,
												type: "Service",
											},
										},
									},
								},
							],
						},
						// Process incoming responses (Accept/Reject/Announce) from external services
						"Process Response": {
							icon: {
								name: "mail",
								color: "#3b82f6",
							},
							triggers: [
								{
									event: AutomationEvent.webhook,
									config: { path: WEBHOOK_PATH },
								},
							],
							// Only process Accept, Reject, or Announce responses (not Offer)
							condition: {
								type: AutomationConditionBlockType.AND,
								items: [
									{
										kind: "condition",
										type: "jsonata",
										expression:
											"'Accept' in $.json.type or 'Reject' in $.json.type or 'Announce' in $.json.type",
									},
								],
							},
							// Resolver finds the Submission pub that matches the inReplyTo field
							// The inReplyTo will be like "urn:uuid:<pub-id>" from our sent Offer
							resolver: `{{ $replace($.json.inReplyTo, "http://localhost:3000/c/coar-notify/pub/", "") }} = $.pub.id`,
							actions: [
								{
									action: Action.log,
									config: {
										text: "Received response: {{ $.json.type }} for pub {{ $.pub.values.title }} ({{ $.pub.id }})",
									},
								},
							],
						},
					},
				},
				Published: {
					id: STAGE_IDS.Published,
					automations: {
						"Announce Review": {
							icon: {
								name: "send",
								color: "#ec4899",
							},
							triggers: [
								{
									event: AutomationEvent.pubEnteredStage,
									config: {},
								},
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
												"id": "http://localhost:8080" & $.community.slug & "/reviews/" & $.pub.id,
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
						"Build Site": {
							icon: {
								name: "globe",
								color: "#6366f1",
							},
							triggers: [
								{
									event: AutomationEvent.pubEnteredStage,
									config: {},
								},
								{
									event: AutomationEvent.manual,
									config: {},
								},
							],
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
									action: Action.buildSite,
									config: {
										css: `:root {
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

.review-list { list-style: none; }
.review-list li { margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--color-border); }
.review-list li:last-child { border-bottom: none; }`,
										subpath: "reviews",
										pages: [
											{
												// Individual review page - one per Review pub
												slug: "$.pub.id",
												filter: '$.pub.pubType.name = "Review"',
												extension: "html",
												transform: `'<link rel="alternate" type="application/json" href="' & $.pub.id & '.json" />' &
'<article>' &
  '<h1>' & $.pub.title & '</h1>' &
  $join(
    $map(
      $filter($keys($.pub.values), function($v){ $not($contains($v, ":")) }),
      function($v){
        '<div class="pub-field">' &
          '<div class="pub-field-label">' & $v & '</div>' &
          '<div class="pub-field-value">' & 
            $string($lookup($.pub.values, $v)) & '</div>' &
        '</div>'
      }
    ),
    ''
  ) &
   '<p><a href="' & $.pub.id & '.json">JSON</a></p>' &
  '<p><a href="/">← Back to all reviews</a></p>' &
'</article>'`,
											},
											{
												// JSON manifest - companion metadata for each review
												slug: "$.pub.id",
												filter: '$.pub.pubType.name = "Review"',
												extension: "json",
												transform: `$string({
  "title": $.pub.title,
  "id": $.pub.id,
  "type": "Review",
  "pubType": $.pub.pubType.name
})`,
											},
											{
												// Index page - lists all published reviews
												slug: '"/"',
												filter: '$.pub.pubType.name = "Review"',
												extension: "html",
												transform: `'<h1>Published Reviews</h1>' &
'<ul class="review-list">' &
  '<li><a href="/coar-notify/reviews/' & $.pub.id & '">' & $.pub.title & '</a></li>' &
'</ul>'`,
											},
										],
										outputMap: [],
									},
								},
							],
						},
					},
				},
				Accepted: {
					id: STAGE_IDS.Accepted,
					automations: {
						"Send Accept Acknowledgement": {
							icon: {
								name: "check",
								color: "#22c55e",
							},
							triggers: [
								{
									event: AutomationEvent.pubEnteredStage,
									config: {},
								},
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
						// Create a Review pub after accepting an Offer (links to Notification)
						"Create Review for Offer": {
							icon: {
								name: "plus-circle",
								color: "#10b981",
							},
							triggers: [
								{
									event: AutomationEvent.pubEnteredStage,
									config: {},
								},
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
										expression: "'Offer' in $eval($.pub.values.Payload).type",
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
										},
										relationConfig: {
											fieldSlug: "coar-notify:relatedpub",
											relatedPubId: "{{ $.pub.id }}",
											value: "Notification",
											direction: "source",
										},
									},
								},
							],
						},
						// Create a Review pub after accepting an Announce Ingest (links to resolved local article)
						"Create Review for Ingest": {
							icon: {
								name: "plus-circle",
								color: "#10b981",
							},
							triggers: [
								{
									event: AutomationEvent.pubEnteredStage,
									config: {},
								},
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
											fieldSlug: "coar-notify:relatedpub",
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
					automations: {
						"Send Reject Acknowledgement": {
							icon: {
								name: "x",
								color: "#ef4444",
							},
							triggers: [
								{
									event: AutomationEvent.pubEnteredStage,
									config: {},
								},
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
			},
			stageConnections: {
				// Incoming notification flow: process and either accept, reject, or create review
				Inbox: {
					to: ["Accepted", "Rejected"],
				},
				// Review workflow (for Reviews created from Notifications)
				ReviewInbox: {
					to: ["Reviewing"],
				},
				Reviewing: {
					to: ["Published"],
				},
				// Outbound request flow: our submissions requesting external reviews
				Submissions: {
					to: ["AwaitingResponse"],
				},
			},
		},
		{
			randomSlug: false,
		}
	)
}
