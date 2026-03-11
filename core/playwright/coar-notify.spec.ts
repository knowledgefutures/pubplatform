import type { StagesId } from "db/public"
import type { CommunitySeedOutput } from "~/prisma/seed/createSeed"

import {
	Action,
	AutomationConditionBlockType,
	AutomationEvent,
	CoreSchemaType,
	MemberRole,
} from "db/public"

import { createSeed } from "~/prisma/seed/createSeed"
import { seedCommunity } from "~/prisma/seed/seedCommunity"
import {
	createAnnounceIngestPayload,
	createAnnounceReviewPayload,
	createOfferReviewPayload,
} from "./fixtures/coar-notify-payloads"
import { LoginPage } from "./fixtures/login-page"
import { StagesManagePage } from "./fixtures/stages-manage-page"
import { expect, test } from "./test-fixtures"

const WEBHOOK_PATH = "coar-inbox"

// ---------------------------------------------------------------------------
// User Story 1: Repository Author Requests Review
// ---------------------------------------------------------------------------

const us1Slug = `coar-us1-${crypto.randomUUID().slice(0, 8)}`

const us1StageIds = {
	Submissions: crypto.randomUUID() as StagesId,
	AwaitingResponse: crypto.randomUUID() as StagesId,
	Completed: crypto.randomUUID() as StagesId,
}

const us1Seed = createSeed({
	community: {
		name: "US1: Arcadia Science",
		slug: us1Slug,
	},
	users: {
		admin: {
			firstName: "Admin",
			lastName: "User",
			email: `us1-admin-${crypto.randomUUID().slice(0, 8)}@example.com`,
			password: "password",
			role: MemberRole.admin,
		},
	},
	pubFields: {
		title: { schemaName: CoreSchemaType.String },
		content: { schemaName: CoreSchemaType.String },
		sourceurl: { schemaName: CoreSchemaType.String },
		relatedpub: { schemaName: CoreSchemaType.String, relation: true },
	},
	pubTypes: {
		Submission: {
			title: { isTitle: true },
			content: { isTitle: false },
		},
		Review: {
			title: { isTitle: true },
			content: { isTitle: false },
			relatedpub: { isTitle: false },
			sourceurl: { isTitle: false },
		},
	},
	stages: {
		Submissions: {
			id: us1StageIds.Submissions,
			automations: {
				"Request Review": {
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
							config: { stage: us1StageIds.AwaitingResponse },
						},
					],
				},
			},
		},
		AwaitingResponse: {
			id: us1StageIds.AwaitingResponse,
			automations: {
				"Send Review Offer": {
					triggers: [{ event: AutomationEvent.pubEnteredStage, config: {} }],
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
								url: "http://stubbed-remote-inbox/inbox",
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
										id: "http://stubbed-remote-inbox",
										inbox: "http://stubbed-remote-inbox/inbox",
										type: "Service",
									},
								},
							},
						},
					],
				},
				"Receive Review Announcement": {
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
								stage: us1StageIds.Completed,
								formSlug: "review-default-editor",
								pubValues: {
									title: "Review: {{ $.json.object.id }}",
									sourceurl: "{{ $.json.object.id }}",
								},
								relationConfig: {
									fieldSlug: `${us1Slug}:relatedpub`,
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
			id: us1StageIds.Completed,
			automations: {},
		},
	},
	pubs: [
		{
			pubType: "Submission",
			stage: "Submissions",
			values: { title: "Sample Paper for Review" },
		},
	],
	stageConnections: {
		Submissions: { to: ["AwaitingResponse"] },
	},
})

// ---------------------------------------------------------------------------
// User Story 2: Review Group Receives Review Request
// ---------------------------------------------------------------------------

const us2Slug = `coar-us2-${crypto.randomUUID().slice(0, 8)}`

const us2StageIds = {
	Inbox: crypto.randomUUID() as StagesId,
	Accepted: crypto.randomUUID() as StagesId,
	Rejected: crypto.randomUUID() as StagesId,
	ReviewInbox: crypto.randomUUID() as StagesId,
	Reviewing: crypto.randomUUID() as StagesId,
	Published: crypto.randomUUID() as StagesId,
}

const us2Seed = createSeed({
	community: {
		name: "US2: The Unjournal",
		slug: us2Slug,
	},
	users: {
		admin: {
			firstName: "Admin",
			lastName: "User",
			email: `us2-admin-${crypto.randomUUID().slice(0, 8)}@example.com`,
			password: "password",
			role: MemberRole.admin,
		},
	},
	pubFields: {
		title: { schemaName: CoreSchemaType.String },
		content: { schemaName: CoreSchemaType.String },
		payload: { schemaName: CoreSchemaType.String },
		sourceurl: { schemaName: CoreSchemaType.String },
		relatedpub: { schemaName: CoreSchemaType.String, relation: true },
	},
	pubTypes: {
		Notification: {
			title: { isTitle: true },
			payload: { isTitle: false },
			sourceurl: { isTitle: false },
			relatedpub: { isTitle: false },
		},
		Review: {
			title: { isTitle: true },
			content: { isTitle: false },
			relatedpub: { isTitle: false },
			sourceurl: { isTitle: false },
		},
	},
	stages: {
		Inbox: {
			id: us2StageIds.Inbox,
			automations: {
				"Process COAR Notification": {
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
								stage: us2StageIds.Inbox,
								formSlug: "notification-default-editor",
								pubValues: {
									title: "URL: {{ $.json.object.id }} - Type: {{ $join($.json.type, ', ') }}",
									payload: "{{ $string($.json) }}",
									sourceurl: "{{ $.json.object.id }}",
								},
							},
						},
					],
				},
				"Accept Request": {
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
						{ action: Action.move, config: { stage: us2StageIds.Accepted } },
					],
				},
				"Reject Request": {
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
						{ action: Action.move, config: { stage: us2StageIds.Rejected } },
					],
				},
			},
		},
		Accepted: {
			id: us2StageIds.Accepted,
			automations: {
				"Create Review for Offer": {
					triggers: [{ event: AutomationEvent.pubEnteredStage, config: {} }],
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
									"'Offer' in $eval($.pub.values.payload).type",
							},
						],
					},
					actions: [
						{
							action: Action.createPub,
							config: {
								stage: us2StageIds.ReviewInbox,
								formSlug: "review-default-editor",
								pubValues: {
									title: "Review for: {{ $.pub.values.title }}",
									sourceurl: "{{ $.pub.values.sourceurl }}",
								},
								relationConfig: {
									fieldSlug: `${us2Slug}:relatedpub`,
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
			id: us2StageIds.Rejected,
			automations: {},
		},
		ReviewInbox: {
			id: us2StageIds.ReviewInbox,
			automations: {
				"Start Review": {
					triggers: [{ event: AutomationEvent.pubEnteredStage, config: {} }],
					actions: [
						{ action: Action.move, config: { stage: us2StageIds.Reviewing } },
					],
				},
			},
		},
		Reviewing: {
			id: us2StageIds.Reviewing,
			automations: {
				"Finish Review": {
					triggers: [{ event: AutomationEvent.pubEnteredStage, config: {} }],
					actions: [
						{ action: Action.move, config: { stage: us2StageIds.Published } },
					],
				},
			},
		},
		Published: {
			id: us2StageIds.Published,
			automations: {
				"Announce Review": {
					triggers: [{ event: AutomationEvent.pubEnteredStage, config: {} }],
					actions: [
						{
							action: Action.http,
							config: {
								url: "http://stubbed-remote-inbox/inbox",
								method: "POST",
								body: `<<< {
									"@context": [
										"https://www.w3.org/ns/activitystreams",
										"https://coar-notify.net"
									],
									"type": ["Announce", "coar-notify:ReviewAction"],
									"id": "urn:uuid:" & $.pub.id,
									"object": {
										"id": $.env.PUBPUB_URL & "/c/" & $.community.slug & "/pubs/" & $.pub.id,
										"type": ["Page", "sorg:Review"],
										"as:inReplyTo": $.pub.values.sourceurl
									},
									"target": {
										"id": "http://stubbed-remote-inbox",
										"inbox": "http://stubbed-remote-inbox/inbox",
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
})

// ---------------------------------------------------------------------------
// User Story 3: Review Group Requests Ingestion By Aggregator
// ---------------------------------------------------------------------------

const us3Slug = `coar-us3-${crypto.randomUUID().slice(0, 8)}`

const us3StageIds = {
	Reviews: crypto.randomUUID() as StagesId,
	Published: crypto.randomUUID() as StagesId,
}

const us3Seed = createSeed({
	community: {
		name: "US3: Review Group",
		slug: us3Slug,
	},
	users: {
		admin: {
			firstName: "Admin",
			lastName: "User",
			email: `us3-admin-${crypto.randomUUID().slice(0, 8)}@example.com`,
			password: "password",
			role: MemberRole.admin,
		},
	},
	pubFields: {
		title: { schemaName: CoreSchemaType.String },
		content: { schemaName: CoreSchemaType.String },
		sourceurl: { schemaName: CoreSchemaType.String },
	},
	pubTypes: {
		Review: {
			title: { isTitle: true },
			content: { isTitle: false },
			sourceurl: { isTitle: false },
		},
	},
	stages: {
		Reviews: {
			id: us3StageIds.Reviews,
			automations: {
				"Publish Review": {
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
							config: { stage: us3StageIds.Published },
						},
					],
				},
			},
		},
		Published: {
			id: us3StageIds.Published,
			automations: {
				"Request Ingest": {
					triggers: [{ event: AutomationEvent.pubEnteredStage, config: {} }],
					actions: [
						{
							action: Action.http,
							config: {
								url: "http://stubbed-remote-inbox/inbox",
								method: "POST",
								body: `<<< {
									"@context": [
										"https://www.w3.org/ns/activitystreams",
										"https://coar-notify.net"
									],
									"type": ["Announce", "coar-notify:ReviewAction"],
									"id": "urn:uuid:" & $.pub.id,
									"object": {
										"id": $.env.PUBPUB_URL & "/c/" & $.community.slug & "/pubs/" & $.pub.id,
										"type": ["Page", "sorg:Review"],
										"as:inReplyTo": $.pub.values.sourceurl
									},
									"target": {
										"id": "http://stubbed-remote-inbox",
										"inbox": "http://stubbed-remote-inbox/inbox",
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
	pubs: [
		{
			pubType: "Review",
			stage: "Reviews",
			values: {
				title: "Sample Review of Research Output",
				sourceurl: "https://www.biorxiv.org/content/10.1101/2024.01.01.123456",
			},
		},
	],
	stageConnections: {
		Reviews: { to: ["Published"] },
	},
})

// ---------------------------------------------------------------------------
// User Story 4: Review Group Aggregation Announcement to Repositories
// ---------------------------------------------------------------------------

const us4Slug = `coar-us4-${crypto.randomUUID().slice(0, 8)}`

const us4StageIds = {
	Articles: crypto.randomUUID() as StagesId,
	Inbox: crypto.randomUUID() as StagesId,
	Accepted: crypto.randomUUID() as StagesId,
	Rejected: crypto.randomUUID() as StagesId,
	ReviewInbox: crypto.randomUUID() as StagesId,
}

const us4Seed = createSeed({
	community: {
		name: "US4: Arcadia Science",
		slug: us4Slug,
	},
	users: {
		admin: {
			firstName: "Admin",
			lastName: "User",
			email: `us4-admin-${crypto.randomUUID().slice(0, 8)}@example.com`,
			password: "password",
			role: MemberRole.admin,
		},
	},
	pubFields: {
		title: { schemaName: CoreSchemaType.String },
		content: { schemaName: CoreSchemaType.String },
		payload: { schemaName: CoreSchemaType.String },
		sourceurl: { schemaName: CoreSchemaType.String },
		relatedpub: { schemaName: CoreSchemaType.String, relation: true },
	},
	pubTypes: {
		Submission: {
			title: { isTitle: true },
			content: { isTitle: false },
		},
		Notification: {
			title: { isTitle: true },
			payload: { isTitle: false },
			sourceurl: { isTitle: false },
			relatedpub: { isTitle: false },
		},
		Review: {
			title: { isTitle: true },
			content: { isTitle: false },
			relatedpub: { isTitle: false },
		},
	},
	stages: {
		Articles: {
			id: us4StageIds.Articles,
			automations: {},
		},
		Inbox: {
			id: us4StageIds.Inbox,
			automations: {
				"Process COAR Notification": {
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
								stage: us4StageIds.Inbox,
								formSlug: "notification-default-editor",
								pubValues: {
									title: "URL: {{ $.json.object.id }} - Type: {{ $join($.json.type, ', ') }}",
									payload: "{{ $string($.json) }}",
									sourceurl: "{{ $.json.object.id }}",
								},
							},
						},
					],
				},
				"Accept Request": {
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
						{ action: Action.move, config: { stage: us4StageIds.Accepted } },
					],
				},
				"Reject Request": {
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
						{ action: Action.move, config: { stage: us4StageIds.Rejected } },
					],
				},
			},
		},
		Accepted: {
			id: us4StageIds.Accepted,
			automations: {
				"Create Review for Ingest": {
					triggers: [{ event: AutomationEvent.pubEnteredStage, config: {} }],
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
									"'Announce' in $eval($.pub.values.payload).type and 'coar-notify:IngestAction' in $eval($.pub.values.payload).type",
							},
						],
					},
					resolver: "$.pub.id = {{ $replace($replace($eval($.pub.values.payload).object.`as:inReplyTo`, $.env.PUBPUB_URL & \"/c/\" & $.community.slug & \"/pubs/\", \"\"), $.env.PUBPUB_URL & \"/c/\" & $.community.slug & \"/pub/\", \"\") }}",
					actions: [
						{
							action: Action.createPub,
							config: {
								stage: us4StageIds.ReviewInbox,
								formSlug: "review-default-editor",
								pubValues: {
									title: "Review from aggregator: {{ $eval($.pub.values.payload).object.id }}",
								},
								relationConfig: {
									fieldSlug: `${us4Slug}:relatedpub`,
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
			id: us4StageIds.Rejected,
			automations: {},
		},
		ReviewInbox: {
			id: us4StageIds.ReviewInbox,
			automations: {},
		},
	},
	pubs: [
		{
			pubType: "Submission",
			stage: "Articles",
			values: { title: "Research Paper on Gene Expression" },
		},
	],
	stageConnections: {
		Inbox: { to: ["Accepted", "Rejected"] },
		Accepted: { to: ["ReviewInbox"] },
	},
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let us1Community: CommunitySeedOutput<typeof us1Seed>
let us2Community: CommunitySeedOutput<typeof us2Seed>
let us3Community: CommunitySeedOutput<typeof us3Seed>
let us4Community: CommunitySeedOutput<typeof us4Seed>

test.beforeAll(async () => {
	;[us1Community, us2Community, us3Community, us4Community] = await Promise.all([
		seedCommunity(us1Seed),
		seedCommunity(us2Seed),
		seedCommunity(us3Seed),
		seedCommunity(us4Seed),
	])
})

test.describe("User Story 1: Repository Author Requests Review", () => {
	test("Author requests review and receives Announce Review back", async ({
		page,
		mockPreprintRepo,
	}) => {
		const loginPage = new LoginPage(page)
		await loginPage.goto()
		await loginPage.loginAndWaitForNavigation(us1Community.users.admin.email, "password")

		const stagesManagePage = new StagesManagePage(page, us1Community.community.slug)

		// Update "Send Review Offer" to point to mock inbox
		await stagesManagePage.goTo()
		await stagesManagePage.openStagePanelTab("AwaitingResponse", "Automations")
		await page.getByText("Send Review Offer").click()
		await page.getByTestId("action-config-card-http-collapse-trigger").click()
		const urlInput = page.getByLabel("Request URL")
		await urlInput.fill(`${mockPreprintRepo.url}/inbox`)
		await page.getByRole("button", { name: "Save automation", exact: true }).click()
		await expect(
			page.getByRole("button", { name: "Save automation", exact: true })
		).toHaveCount(0)

		// Move Submission to AwaitingResponse to trigger outgoing Offer
		await stagesManagePage.goTo()
		await stagesManagePage.openStagePanelTab("Submissions", "Pubs")
		await page.getByRole("button", { name: "Submissions" }).first().click()
		await page.getByText("Move to AwaitingResponse").click()
		await expect(page.getByText("Sample Paper for Review")).toHaveCount(0, {
			timeout: 15000,
		})

		// Verify mock repo received the Offer
		await expect
			.poll(() => mockPreprintRepo.getReceivedNotifications().length, { timeout: 15000 })
			.toBeGreaterThan(0)

		const offer = mockPreprintRepo
			.getReceivedNotifications()
			.find((n) => (Array.isArray(n.type) ? n.type.includes("Offer") : n.type === "Offer"))
		expect(offer).toBeDefined()

		// Simulate PreReview sending an Announce Review back
		const webhookUrl = `${process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000"}/api/v0/c/${us1Community.community.slug}/site/webhook/${WEBHOOK_PATH}`
		const submissionPub = us1Community.pubs[0]
		const paperUrl = `${process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000"}/c/${us1Community.community.slug}/pub/${submissionPub.id}`

		const announceReview = createAnnounceReviewPayload({
			preprintId: "mock-review-001",
			reviewId: "review-from-prereview",
			repositoryUrl: paperUrl.replace(`/pub/${submissionPub.id}`, ""),
			serviceUrl: mockPreprintRepo.url,
			serviceName: "PreReview",
		})
		// Override as:inReplyTo to point to the actual paper URL
		announceReview.object["as:inReplyTo"] = paperUrl

		await mockPreprintRepo.sendNotification(webhookUrl, announceReview)

		// Verify Review pub was created in Completed stage
		await expect
			.poll(
				async () => {
					await page.goto(`/c/${us1Community.community.slug}/stages`)
					const reviewText = page.getByText("Review:", { exact: false })
					return (await reviewText.count()) > 0
				},
				{ timeout: 15000 }
			)
			.toBe(true)
	})
})

test.describe("User Story 2: Review Group Receives Review Request", () => {
	test("Review group receives Offer, processes review, and sends Announce", async ({
		page,
		mockPreprintRepo,
	}) => {
		const loginPage = new LoginPage(page)
		await loginPage.goto()
		await loginPage.loginAndWaitForNavigation(us2Community.users.admin.email, "password")

		const stagesManagePage = new StagesManagePage(page, us2Community.community.slug)

		// Update "Announce Review" automation to point to mock inbox
		await stagesManagePage.goTo()
		await stagesManagePage.openStagePanelTab("Published", "Automations")
		await page.getByText("Announce Review").click()
		await page.getByTestId("action-config-card-http-collapse-trigger").click()
		const announceUrlInput = page.getByLabel("Request URL")
		await announceUrlInput.fill(`${mockPreprintRepo.url}/inbox`)
		await page.getByRole("button", { name: "Save automation", exact: true }).click()
		await expect(
			page.getByRole("button", { name: "Save automation", exact: true })
		).toHaveCount(0)

		// Send an Offer to the community's webhook (simulating external repository)
		const webhookUrl = `${process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000"}/api/v0/c/${us2Community.community.slug}/site/webhook/${WEBHOOK_PATH}`
		const incomingOffer = createOfferReviewPayload({
			preprintId: "54321",
			repositoryUrl: mockPreprintRepo.url,
			serviceUrl: `${process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000"}/c/${us2Community.community.slug}`,
		})

		await mockPreprintRepo.sendNotification(webhookUrl, incomingOffer)

		// Verify Notification was created
		await page.goto(`/c/${us2Community.community.slug}/activity/automations`)
		const card = page
			.getByTestId(/automation-run-card-.*-Process COAR Notification/)
			.first()
		await expect(card).toBeVisible({ timeout: 15000 })

		// The automation chain runs:
		// Process COAR Notification → Create Review for Offer → Start Review → Finish Review → Announce Review

		// Verify mock repo receives the Announce Review
		await expect
			.poll(
				() =>
					mockPreprintRepo
						.getReceivedNotifications()
						.find((n) =>
							Array.isArray(n.type)
								? n.type.includes("Announce")
								: n.type === "Announce"
						),
				{ timeout: 30000 }
			)
			.toBeDefined()

		const finalAnnounce = mockPreprintRepo
			.getReceivedNotifications()
			.find((n) =>
				Array.isArray(n.type) ? n.type.includes("Announce") : n.type === "Announce"
			)
		expect(finalAnnounce).toBeDefined()
		expect(finalAnnounce?.object?.["as:inReplyTo"]).toBe(
			`${mockPreprintRepo.url}/preprint/54321`
		)
	})
})

test.describe("User Story 3: Review Group Requests Ingestion By Aggregator", () => {
	test("Review group publishes review and sends ingest request to aggregator", async ({
		page,
		mockPreprintRepo,
	}) => {
		const loginPage = new LoginPage(page)
		await loginPage.goto()
		await loginPage.loginAndWaitForNavigation(us3Community.users.admin.email, "password")

		const stagesManagePage = new StagesManagePage(page, us3Community.community.slug)

		// Update "Request Ingest" automation to point to mock inbox
		await stagesManagePage.goTo()
		await stagesManagePage.openStagePanelTab("Published", "Automations")
		await page.getByText("Request Ingest").click()
		await page.getByTestId("action-config-card-http-collapse-trigger").click()
		const urlInput = page.getByLabel("Request URL")
		await urlInput.fill(`${mockPreprintRepo.url}/inbox`)
		await page.getByRole("button", { name: "Save automation", exact: true }).click()
		await expect(
			page.getByRole("button", { name: "Save automation", exact: true })
		).toHaveCount(0)

		// Move Review to Published to trigger the ingest request
		await stagesManagePage.goTo()
		await stagesManagePage.openStagePanelTab("Reviews", "Pubs")
		await page.getByRole("button", { name: "Reviews" }).first().click()
		await page.getByText("Move to Published").click()
		await expect(page.getByText("Sample Review of Research Output")).toHaveCount(0, {
			timeout: 15000,
		})

		// Verify mock aggregator (Sciety) received the Announce
		await expect
			.poll(() => mockPreprintRepo.getReceivedNotifications().length, { timeout: 15000 })
			.toBeGreaterThan(0)

		const announces = mockPreprintRepo
			.getReceivedNotifications()
			.filter((n) =>
				Array.isArray(n.type) ? n.type.includes("Announce") : n.type === "Announce"
			)

		expect(announces.length).toBe(1)

		const announce = announces[0]
		expect(announce).toBeDefined()
		expect(announce.type).toMatchObject(["Announce", "coar-notify:ReviewAction"])
		expect(announce.object.id).toMatch(
			`http://localhost:3000/c/${us3Community.community.slug}/pubs/`
		)
		expect(announce.object.type).toMatchObject(["Page", "sorg:Review"])
		expect(announce.object["as:inReplyTo"]).toBe(
			"https://www.biorxiv.org/content/10.1101/2024.01.01.123456"
		)
	})
})

test.describe("User Story 4: Review Group Aggregation Announcement to Repositories", () => {
	test("Repository receives ingestion announcement and creates linked review", async ({
		page,
		mockPreprintRepo,
	}) => {
		const loginPage = new LoginPage(page)
		await loginPage.goto()
		await loginPage.loginAndWaitForNavigation(us4Community.users.admin.email, "password")

		const baseUrl = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000"
		const webhookUrl = `${baseUrl}/api/v0/c/${us4Community.community.slug}/site/webhook/${WEBHOOK_PATH}`

		const submissionPub = us4Community.pubs[0]
		const workUrl = `${baseUrl}/c/${us4Community.community.slug}/pub/${submissionPub.id}`

		const ingestionAnnouncement = createAnnounceIngestPayload({
			reviewId: "review-123",
			serviceUrl: "https://review-group.org",
			aggregatorUrl: mockPreprintRepo.url,
			workUrl,
		})

		await mockPreprintRepo.sendNotification(webhookUrl, ingestionAnnouncement)

		// Verify Notification pub creation
		await page.goto(`/c/${us4Community.community.slug}/stages`)
		await expect(
			page
				.getByText("URL: https://review-group.org/review/review-123", { exact: false })
				.first()
		).toBeVisible({
			timeout: 15000,
		})

		// Accept the notification to trigger Create Review for Ingest
		const stagesManagePage = new StagesManagePage(page, us4Community.community.slug)
		await stagesManagePage.goTo()
		await stagesManagePage.openStagePanelTab("Inbox", "Pubs")
		await page.getByRole("button", { name: "Inbox" }).first().click()
		await page.getByText("Move to Accepted").click()

		// Verify Review was created and linked to the Submission
		await expect
			.poll(
				async () => {
					await page.goto(`/c/${us4Community.community.slug}/stages`)
					const reviewList = page.getByText("Review from aggregator:", {
						exact: false,
					})
					return (await reviewList.count()) > 0
				},
				{ timeout: 15000 }
			)
			.toBe(true)
	})
})
