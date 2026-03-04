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
	createOfferReviewPayload,
} from "./fixtures/coar-notify-payloads"
import { LoginPage } from "./fixtures/login-page"
import { StagesManagePage } from "./fixtures/stages-manage-page"
import { expect, test } from "./test-fixtures"

const WEBHOOK_PATH = "coar-inbox"
const COMMUNITY_SLUG = `coar-test-${crypto.randomUUID().slice(0, 8)}`

const STAGE_IDS = {
	Inbox: crypto.randomUUID() as StagesId,
	ReviewRequested: crypto.randomUUID() as StagesId,
	Accepted: crypto.randomUUID() as StagesId,
	Rejected: crypto.randomUUID() as StagesId,
	Published: crypto.randomUUID() as StagesId,
	ReviewInbox: crypto.randomUUID() as StagesId,
	Reviewing: crypto.randomUUID() as StagesId,
}

const seed = createSeed({
	community: {
		name: "COAR Test Community",
		slug: COMMUNITY_SLUG,
	},
	users: {
		admin: {
			firstName: "Admin",
			lastName: "User",
			email: `admin-${crypto.randomUUID().slice(0, 8)}@example.com`,
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
			sourceurl: { isTitle: false },
		},
	},
	stages: {
		Inbox: {
			id: STAGE_IDS.Inbox,
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
									title: "URL: {{ $.json.object.id }} - Type: {{ $join($.json.type, ', ') }}",
									payload: "{{ $string($.json) }}",
									sourceurl: "{{ $.json.object.id }}",
								},
							},
						},
					],
				},
				"Create Review for Offer": {
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
								expression: "'Offer' in $eval($.pub.values.payload).type",
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
									title: "Review for: {{ $.pub.values.title }}",
									sourceurl: "{{ $.pub.values.sourceurl }}",
								},
								relationConfig: {
									fieldSlug: `${COMMUNITY_SLUG}:relatedpub`,
									relatedPubId: "{{ $.pub.id }}",
									value: "Notification",
									direction: "source",
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
					actions: [{ action: Action.move, config: { stage: STAGE_IDS.Accepted } }],
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
					actions: [{ action: Action.move, config: { stage: STAGE_IDS.Rejected } }],
				},
			},
		},
		Accepted: {
			id: STAGE_IDS.Accepted,
			automations: {
				"Create Review for Ingest": {
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
									"'Announce' in $eval($.pub.values.payload).type and 'coar-notify:IngestAction' in $eval($.pub.values.payload).type",
							},
						],
					},
					resolver: `$.pub.id = {{ $replace($replace($eval($.pub.values.payload).object["as:inReplyTo"], $.env.PUBPUB_URL & "/c/" & $.community.slug & "/pubs/", ""), $.env.PUBPUB_URL & "/c/" & $.community.slug & "/pub/", "") }}`,
					actions: [
						{
							action: Action.createPub,
							config: {
								stage: STAGE_IDS.ReviewInbox,
								formSlug: "review-default-editor",
								pubValues: {
									title:
										"Review from aggregator: {{ $eval($.pub.values.payload).object.id }}",
								},
								relationConfig: {
									fieldSlug: `${COMMUNITY_SLUG}:relatedpub`,
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
			automations: {
				"Start Review": {
					triggers: [{ event: AutomationEvent.pubEnteredStage, config: {} }],
					actions: [{ action: Action.move, config: { stage: STAGE_IDS.Reviewing } }],
				},
			},
		},
		Reviewing: {
			id: STAGE_IDS.Reviewing,
			automations: {
				"Finish Review": {
					triggers: [{ event: AutomationEvent.pubEnteredStage, config: {} }],
					actions: [{ action: Action.move, config: { stage: STAGE_IDS.Published } }],
				},
			},
		},
		ReviewRequested: {
			id: STAGE_IDS.ReviewRequested,
			automations: {
				"Offer Review": {
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
										id: "{{ $.env.PUBPUB_URL }}/c/{{ $.community.slug }}/pubs/{{ $.pub.id }}",
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
			},
		},
		Published: {
			id: STAGE_IDS.Published,
			automations: {
				"Announce Review": {
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
			pubType: "Submission",
			stage: "Inbox",
			values: { title: "Pre-existing Pub" },
		},
	],
	stageConnections: {
		Inbox: {
			to: ["ReviewRequested", "Published", "Accepted", "Rejected"],
		},
		Accepted: {
			to: ["ReviewInbox"],
		},
		ReviewInbox: {
			to: ["Reviewing"],
		},
		Reviewing: {
			to: ["Published"],
		},
	},
})

let community: CommunitySeedOutput<typeof seed>

test.beforeAll(async () => {
	community = await seedCommunity(seed)
})

test.describe("User Story 1 & 2: Review Request & Reception", () => {
	test("Author requests review (US1) and Review Group receives it (US2)", async ({
		page,
		mockPreprintRepo,
	}) => {
		const loginPage = new LoginPage(page)
		await loginPage.goto()
		await loginPage.loginAndWaitForNavigation(community.users.admin.email, "password")

		const stagesManagePage = new StagesManagePage(page, community.community.slug)

		// --- Step 1: Author (Arcadia Science) requests review ---
		// Update "Offer Review" automation to point to mock inbox
		await stagesManagePage.goTo()
		await stagesManagePage.openStagePanelTab("ReviewRequested", "Automations")
		await page.getByText("Offer Review").click()
		await page.getByTestId("action-config-card-http-collapse-trigger").click()
		const urlInput = page.getByLabel("Request URL")
		await urlInput.fill(`${mockPreprintRepo.url}/inbox`)
		await page.getByRole("button", { name: "Save automation", exact: true }).click()
		await expect(
			page.getByRole("button", { name: "Save automation", exact: true })
		).toHaveCount(0)

		// Update "Announce Review" automation to point to mock inbox (for the end of the fake workflow)
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

		// Move pub to ReviewRequested stage to trigger outgoing Offer
		await stagesManagePage.goTo()
		await stagesManagePage.openStagePanelTab("Inbox", "Pubs")
		await page.getByRole("button", { name: "Inbox" }).first().click()
		await page.getByText("Move to ReviewRequested").click()

		// Wait for the move to complete
		await expect(page.getByText("Pre-existing Pub")).toHaveCount(0, { timeout: 15000 })

		// Verify mock repo received the Offer
		await expect
			.poll(() => mockPreprintRepo.getReceivedNotifications().length, { timeout: 15000 })
			.toBeGreaterThan(0)

		const offer = mockPreprintRepo
			.getReceivedNotifications()
			.find((n) => (Array.isArray(n.type) ? n.type.includes("Offer") : n.type === "Offer"))
		expect(offer).toBeDefined()

		// Clear received notifications to prepare for the next step
		mockPreprintRepo.clearReceivedNotifications()

		// --- Step 2: Review Group (The Unjournal) receives the request and processes it through a fake workflow ---
		const webhookUrl = `${process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000"}/api/v0/c/${community.community.slug}/site/webhook/${WEBHOOK_PATH}`
		const incomingOffer = createOfferReviewPayload({
			preprintId: "54321",
			repositoryUrl: mockPreprintRepo.url,
			serviceUrl: `${process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000"}/c/${community.community.slug}`,
		})

		await mockPreprintRepo.sendNotification(webhookUrl, incomingOffer)

		// Verify that a Notification pub was created
		await page.goto(`/c/${community.community.slug}/activity/automations`)
		const card = page.getByTestId(/automation-run-card-.*-Process COAR Notification/).first()
		await expect(card).toBeVisible({ timeout: 15000 })

		// The chain of automations should now run:
		// 1. Process COAR Notification (Inbox) -> Creates Notification pub in Inbox
		// 2. Create Review for Notification (Inbox) -> Creates Review pub in ReviewInbox
		// 3. Start Review (ReviewInbox) -> Moves Review pub to Reviewing
		// 4. Finish Review (Reviewing) -> Moves Review pub to Published
		// 5. Announce Review (Published) -> Sends Announce to mock repository

		// Verify that the mock repository eventually receives the Announce notification
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

		// Check the stages to see if the Review pub reached Published
		await page.goto(`/c/${community.community.slug}/stages`)
		await expect(
			page.getByText(`URL: ${mockPreprintRepo.url}/preprint/54321`, { exact: false }).first()
		).toBeVisible({
			timeout: 15000,
		})
	})
})

test.describe("User Story 3: Review Group Requests Ingestion By Aggregator", () => {
	test("Review Group requests ingestion to Sciety", async ({ page, mockPreprintRepo }) => {
		const loginPage = new LoginPage(page)
		await loginPage.goto()
		await loginPage.loginAndWaitForNavigation(community.users.admin.email, "password")

		const stagesManagePage = new StagesManagePage(page, community.community.slug)

		// Update "Announce Review" automation (acting as Ingest Request for this test)
		await stagesManagePage.goTo()
		await stagesManagePage.openStagePanelTab("Published", "Automations")
		await page.getByText("Announce Review").click()
		await page.getByTestId("action-config-card-http-collapse-trigger").click()
		const urlInput = page.getByLabel("Request URL")
		await urlInput.fill(`${mockPreprintRepo.url}/inbox`)
		await page.getByRole("button", { name: "Save automation", exact: true }).click()
		await expect(
			page.getByRole("button", { name: "Save automation", exact: true })
		).toHaveCount(0)

		// Move pub to Published to trigger the announcement/ingest request
		await stagesManagePage.goTo()
		await stagesManagePage.openStagePanelTab("Inbox", "Pubs")
		await page.getByRole("button", { name: "Inbox" }).first().click()
		await page.getByText("Move to Published").click()

		// Wait for the move to complete
		await expect(page.getByText("Pre-existing Pub")).toHaveCount(0, { timeout: 15000 })

		// Verify mock repo (Sciety) received the Announce
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
			`http://localhost:3000/c/${community.community.slug}/pubs/`
		)
		expect(announce.object.type).toMatchObject(["Page", "sorg:Review"])
	})
})

test.describe("User Story 4: Review Group Aggregation Announcement to Repositories", () => {
	test("Arcadia Science receives ingestion announcement from Sciety", async ({
		page,
		mockPreprintRepo,
	}) => {
		const loginPage = new LoginPage(page)
		await loginPage.goto()
		await loginPage.loginAndWaitForNavigation(community.users.admin.email, "password")

		const baseUrl = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000"
		const webhookUrl = `${baseUrl}/api/v0/c/${community.community.slug}/site/webhook/${WEBHOOK_PATH}`

		const submissionPub = community.pubs[0]
		const workUrl = `${baseUrl}/c/${community.community.slug}/pub/${submissionPub.id}`

		const ingestionAnnouncement = createAnnounceIngestPayload({
			reviewId: "review-123",
			serviceUrl: "https://review-group.org",
			aggregatorUrl: mockPreprintRepo.url,
			workUrl,
		})

		await mockPreprintRepo.sendNotification(webhookUrl, ingestionAnnouncement)

		// Verify Notification pub creation
		await page.goto(`/c/${community.community.slug}/stages`)
		await expect(
			page
				.getByText("URL: https://review-group.org/review/review-123", { exact: false })
				.first()
		).toBeVisible({
			timeout: 15000,
		})

		// Accept the notification to trigger Create Review for Ingest
		const stagesManagePage = new StagesManagePage(page, community.community.slug)
		await stagesManagePage.goTo()
		await stagesManagePage.openStagePanelTab("Inbox", "Pubs")
		await page.getByRole("button", { name: "Inbox" }).first().click()
		await page.getByText("Move to Accepted").click()

		// Verify Review was created and linked to the Submission (Pre-existing Pub)
		await expect
			.poll(
				async () => {
					await page.goto(`/c/${community.community.slug}/stages`)
					const reviewList = page.getByText("Review from aggregator:", { exact: false })
					return (await reviewList.count()) > 0
				},
				{ timeout: 15000 }
			)
			.toBe(true)
	})
})
