import { describe, expect, it } from "vitest"

import { Action, ActionRunStatus, AutomationEvent, CoreSchemaType } from "db/public"

import { mockServerCode } from "~/lib/__tests__/utils"

const { createForEachMockedTransaction, getCommunity } = await mockServerCode()
const { getTrx } = createForEachMockedTransaction()

const pubTriggerTestSeed = async () => {
	const slugName = `test-server-pub-${new Date().toISOString()}`
	getCommunity.mockImplementation(() => {
		return {
			slug: slugName,
		}
	})
	const { createSeed } = await import("~/prisma/seed/createSeed")

	return createSeed({
		community: {
			name: "test",
			slug: slugName,
		},
		pubFields: {
			Title: { schemaName: CoreSchemaType.String },
			Description: { schemaName: CoreSchemaType.String },
		},
		pubTypes: {
			"Basic Pub": {
				Title: { isTitle: true },
				Description: { isTitle: false },
			},
		},
		stages: {
			Submission: {
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
								action: Action.log,
								config: {
									debounce: 1,
								},
							},
						],
					},
					"2": {
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
									recipientEmail: "all@pubstar.org",
									body: "Hello",
									subject: "Test",
								},
							},
						],
					},
					"3": {
						triggers: [
							{
								event: AutomationEvent.manual,
								config: {},
							},
						],
						actions: [
							{
								action: Action.googleDriveImport,
								config: {
									folderUrl: "https://drive.google.com/drive/folders/1234567890",
									outputField: `${slugName}:title`,
								},
							},
						],
					},
				},
			},
		},
		pubs: [
			{
				pubType: "Basic Pub",
				values: {
					Title: "Some title",
					Description: "Some description",
				},
				stage: "Submission",
			},
		],
		forms: {},
	})
}

describe("runAutomation", () => {
	it("should be able to successfully run the most simple automation", async () => {
		const { seedCommunity } = await import("~/prisma/seed/seedCommunity")
		const { pubs, stages, community } = await seedCommunity(await pubTriggerTestSeed(), {
			randomSlug: false,
		})
		const { runAutomation } = await import("~/actions/_lib/runAutomation")

		const logActionInstance = stages.Submission.automations["1"].actionInstances.find(
			(a) => a.action === Action.log
		)!
		const result = await runAutomation({
			pubId: pubs[0].id,
			trigger: {
				event: AutomationEvent.manual,
				config: {},
			},
			manualActionInstancesOverrideArgs: {},
			communityId: community.id,
			stack: [],
			automationId: stages.Submission.automations["1"].id,
			user: null,
		})
		expect(result.actionRuns).toHaveLength(1)

		expect(result).toMatchObject({
			success: true,
			actionRuns: [
				{
					report: "Logged out some data, check your console.",
					data: {},
				},
			],
		})

		const actionRuns = await getTrx()
			.selectFrom("action_runs")
			.where("pubId", "=", pubs[0].id)
			.where("actionInstanceId", "=", logActionInstance.id)
			.selectAll()
			.execute()

		expect(actionRuns).toHaveLength(1)

		expect(actionRuns[0].status).toEqual(ActionRunStatus.success)
		expect(actionRuns[0].result, "Action run should be successfully created").toMatchObject({
			success: true,
			report: "Logged out some data, check your console.",
			data: {},
		})
	}, 10_000)
})
