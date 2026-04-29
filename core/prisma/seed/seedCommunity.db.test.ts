import type { ApiAccessTokensId, PubsId, PubTypesId, StagesId, UsersId } from "db/public"

import { faker } from "@faker-js/faker"
import { jsonArrayFrom } from "kysely/helpers/postgres"
import { describe, expect, test } from "vitest"

import {
	Action,
	AutomationEvent,
	CoreSchemaType,
	ElementType,
	InputComponent,
	MemberRole,
	StructuralFormElement,
} from "db/public"

import { mockServerCode } from "~/lib/__tests__/utils"
import { allPermissions } from "~/lib/server/apiAccessTokens"

const { createForEachMockedTransaction } = await mockServerCode()

const { getTrx, rollback } = createForEachMockedTransaction()

describe("seedCommunity", () => {
	test("Should be able to create some sort of community", async () => {
		const trx = getTrx()

		const seedCommunity = await import("./seedCommunity").then((mod) => mod.seedCommunity)
		const testUserId = crypto.randomUUID() as UsersId

		const submissionPubId = crypto.randomUUID() as PubsId
		const authorPubId = crypto.randomUUID() as PubsId
		const author2PubId = crypto.randomUUID() as PubsId

		const stage1Id = crypto.randomUUID() as StagesId
		const AuthorPubTypeId = crypto.randomUUID() as PubTypesId

		const email = faker.internet.email()

		const seededCommunity = await seedCommunity({
			community: {
				name: "test",
				slug: "test-community",
			},
			pubFields: {
				Title: { schemaName: CoreSchemaType.String },
				SubmissionAuthor: { schemaName: CoreSchemaType.Number, relation: true },
			},
			pubTypes: {
				Submission: {
					Title: { isTitle: true },
					SubmissionAuthor: { isTitle: false },
				},
				Author: {
					id: AuthorPubTypeId,
					fields: {
						Title: { isTitle: true },
					},
				},
			},
			users: {
				test: {
					id: testUserId,
					firstName: "Testy",
					email,
					lastName: "McTestFace",
					role: MemberRole.admin,
				},
				hih: {
					role: MemberRole.contributor,
				},
			},
			stages: {
				"Stage 1": {
					id: stage1Id,
					members: { hih: MemberRole.contributor },
					automations: {
						"1": {
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
										body: "hello nerd",
										subject: "hello nerd",
										recipientEmail: "all@pubstar.org",
									},
								},
							],
						},
					},
				},
				"Stage 2": {},
			},
			pubs: [
				{
					id: authorPubId,
					pubType: "Author",
					values: {
						Title: "De Heer Frederick I",
					},
				},
				{
					id: submissionPubId,
					pubType: "Submission",
					values: {
						Title: "HENK",
						SubmissionAuthor: [{ value: 0, relatedPubId: authorPubId }],
					},
					stage: "Stage 1",
					relatedPubs: {
						SubmissionAuthor: [
							{
								// indicates that it's the first pub
								value: 1,
								pub: {
									pubType: "Author",
									values: {
										Title: "De Heer Frederick III",
									},
								},
							},
							{
								value: 2,
								pub: {
									pubType: "Author",
									values: {
										Title: "De Heer Frederick IV",
									},
								},
							},
						],
					},
				},
				{
					id: author2PubId,
					pubType: "Author",
					values: {
						Title: "De Heer Frederick II",
					},
				},
			],

			forms: {
				"submission-form": {
					pubType: "Submission",
					elements: [
						{
							type: ElementType.structural,
							element: StructuralFormElement.p,
							content: "# Hey, what is up.",
						},
						{
							type: ElementType.pubfield,
							component: InputComponent.textInput,
							field: "Title",
							config: {
								label: "Title hihihi",
							},
						},
						{
							type: ElementType.button,
							label: "Submit",
							content: "Submit",
							stage: "Stage 1",
						},
					],
				},
				"author-form": {
					pubType: "Author",
					elements: [
						{
							type: ElementType.pubfield,
							component: InputComponent.textInput,
							field: "Title",
							config: { label: "Name" },
						},
					],
				},
			},
			apiTokens: {
				"all token": {},
				"test-token": {
					permissions: {
						pub: {
							read: {
								stages: ["no-stage", stage1Id],
								pubTypes: [AuthorPubTypeId],
							},
						},
					},
				},
			},
		})

		expect(seededCommunity).toBeDefined()

		expect(seededCommunity.community, "community").toMatchObject({
			name: "test",
		})

		expect(seededCommunity.automations, "automations").toMatchObject({
			"1": {
				triggers: expect.any(Array),
				actionInstances: expect.arrayContaining([
					expect.objectContaining({
						action: "email",
						config: expect.objectContaining({
							body: "hello nerd",
							subject: "hello nerd",
						}),
					}),
				]),
			},
		})

		expect(seededCommunity.users, "users").toMatchObject({
			hih: {},
			test: {},
		})

		expect(seededCommunity.members, "members").toMatchObject([
			{
				role: "admin",
			},
			{
				role: "contributor",
			},
		])

		expect(seededCommunity.pubFields, "pubFields").toMatchObject({
			Title: {
				isRelation: false,
				name: "Title",
				schemaName: "String",
			},
			SubmissionAuthor: {
				isRelation: true,
				name: "SubmissionAuthor",
				schemaName: "Number",
			},
		})

		expect(seededCommunity.pubTypes, "pubTypes").toMatchObject({
			Submission: {
				description: null,
				name: "Submission",
			},
			Author: {
				id: AuthorPubTypeId,
				name: "Author",
			},
		})

		expect(seededCommunity.pubs, "pubs").toMatchObject([
			{ id: authorPubId },
			{
				id: submissionPubId,
				values: [
					{
						relatedPubId: null,
						value: "HENK",
					},
					{
						relatedPubId: authorPubId,
						value: 0,
					},
					{
						value: 1,
						relatedPub: {
							pubTypeId: seededCommunity.pubTypes.Author.id,
						},
					},
					{
						value: 2,
						relatedPub: {
							pubTypeId: seededCommunity.pubTypes.Author.id,
						},
					},
				],
				valuesBlob: null,
				stageId: seededCommunity.stages["Stage 1"].id,
			},
			{ id: author2PubId },
		])

		expect(seededCommunity.stageConnections, "stageConnections").toMatchObject([])

		expect(seededCommunity.stages, "stages").toMatchObject({
			"Stage 1": {
				members: { hih: MemberRole.contributor },
				name: "Stage 1",
				order: "aa",
			},
			"Stage 2": {
				name: "Stage 2",
				order: "bb",
			},
		})

		expect(seededCommunity.forms, "forms").toMatchObject({
			"submission-form": {
				access: "private",
				elements: [
					{
						component: null,
						config: null,
						content: "# Hey, what is up.",
						element: "p",
						fieldId: null,
						label: null,
						rank: "F",
						required: null,
						stageId: null,
						type: "structural",
					},
					{
						component: "textInput",
						config: {
							label: "Title hihihi",
						},
						content: null,
						element: null,
						label: null,
						rank: "U",
						required: null,
						stageId: null,
						type: "pubfield",
					},
					{
						component: null,
						config: null,
						content: "Submit",
						element: null,
						fieldId: null,
						label: "Submit",
						rank: "k",
						required: null,
						stageId: null,
						type: "button",
					},
				],
				isArchived: false,
				name: "submission-form",
				slug: "submission-form",
			},
			"author-form": {
				access: "private",
				elements: [
					{
						component: "textInput",
						config: {
							label: "Name",
						},
						content: null,
						element: null,
						label: null,
						rank: "U",
						required: null,
						stageId: null,
						type: "pubfield",
					},
				],
				isArchived: false,
				name: "author-form",
				slug: "author-form",
			},
		})

		expect(seededCommunity.apiTokens, "apiTokens").toMatchObject({
			"all token": expect.stringMatching(/^[a-f0-9-]{36}\..{22}$/),
			"test-token": expect.stringMatching(/^[a-f0-9-]{36}\..{22}$/),
		})

		const permissions = await trx
			.selectFrom("api_access_tokens")
			.selectAll("api_access_tokens")
			.select((eb) =>
				jsonArrayFrom(
					eb
						.selectFrom("api_access_permissions")
						.selectAll("api_access_permissions")
						.whereRef(
							"api_access_permissions.apiAccessTokenId",
							"=",
							eb.ref("api_access_tokens.id")
						)
				).as("permissions")
			)
			.where("api_access_tokens.id", "in", [
				seededCommunity.apiTokens["test-token"].split(".")[0] as ApiAccessTokensId,
				seededCommunity.apiTokens["all token"].split(".")[0] as ApiAccessTokensId,
			])
			.execute()

		const testToken = permissions.find((token) => token.name === "test-token")
		const allToken = permissions.find((token) => token.name === "all token")

		expect(testToken?.permissions).toMatchObject([
			{
				scope: "pub",
				accessType: "read",
				constraints: {
					stages: expect.arrayContaining(["no-stage", stage1Id]),
					pubTypes: [AuthorPubTypeId],
				},
			},
		])

		expect(
			allToken?.permissions?.sort((a, b) =>
				`${a.scope}-${a.accessType}`.localeCompare(`${b.scope}-${b.accessType}`)
			)
		).toMatchObject(
			allPermissions.sort((a, b) =>
				`${a.scope}-${a.accessType}`.localeCompare(`${b.scope}-${b.accessType}`)
			)
		)

		rollback()
	})
})
