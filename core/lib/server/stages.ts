import type { StageAutomationSelectOptions } from "contracts"
import type { ConditionBlock } from "db/types"
import type { ExpressionBuilder, QueryCreator, SelectQueryBuilder } from "kysely"
import type { AutoReturnType } from "../types"

import { cache } from "react"
import { sql } from "kysely"
import { jsonArrayFrom, jsonObjectFrom } from "kysely/helpers/postgres"

import {
	type AutomationEvent,
	Capabilities,
	type CommunitiesId,
	MembershipType,
	type NewMoveConstraint,
	type NewStages,
	type PublicSchema,
	type PubsId,
	type StagesId,
	type StagesUpdate,
	type UsersId,
} from "db/public"
import { expect } from "utils"

import { db } from "~/kysely/database"
import { duplicateAutomation } from "./automations"
import { autoCache } from "./cache/autoCache"
import { autoRevalidate } from "./cache/autoRevalidate"
import { maybeWithTrx } from "./maybeWithTrx"

export const createStage = (props: NewStages, trx = db) =>
	autoRevalidate(trx.insertInto("stages").values(props).returningAll())

export const updateStage = (stageId: StagesId, props: StagesUpdate, trx = db) =>
	autoRevalidate(trx.updateTable("stages").set(props).where("id", "=", stageId))

export const removeStages = (stageIds: StagesId[]) =>
	autoRevalidate(
		db
			.with("deleted_stages", (db) =>
				db
					.deleteFrom("stages")
					.where("id", "in", stageIds as StagesId[])
					.returning("id")
			)
			.deleteFrom("PubsInStages")
			.where("stageId", "in", (eb) => eb.selectFrom("deleted_stages").select("id"))
	)

export const createMoveConstraint = (props: NewMoveConstraint, trx = db) =>
	autoRevalidate(trx.insertInto("move_constraint").values(props).returningAll())

/**
 * You should use `executeTakeFirst` here
 */
export const getPubIdsInStage = (stageId: StagesId) =>
	autoCache(
		db
			.selectFrom("PubsInStages")
			.select(sql<PubsId[]>`array_agg("pubId")`.as("pubIds"))
			.where("stageId", "=", stageId)
	)

/** To conveniently get a CTE of view stage capabilities. Join this to your query on stageId, i.e.
 *
 * db
 *	.with("viewableStages", (db) => viewableStagesCte({ db: db, userId, communityId }))
 *	.selectFrom("stages")
 *	.innerJoin("viewableStages", "viewableStages.stageId", "stages.id")
 */
export const viewableStagesCte = ({
	db,
	userId,
	communityId,
}: {
	db: QueryCreator<PublicSchema>
	userId: UsersId
	communityId?: CommunitiesId
}) => {
	const stageMemberships = db
		.selectFrom("stage_memberships")
		.innerJoin("membership_capabilities", (join) =>
			join
				.onRef("stage_memberships.role", "=", "membership_capabilities.role")
				.on("membership_capabilities.type", "=", MembershipType.stage)
		)
		.$if(Boolean(communityId), (qb) =>
			qb
				.innerJoin("stages", "stages.id", "stage_memberships.stageId")
				.where("stages.communityId", "=", communityId!)
		)
		.select("stage_memberships.stageId")
		.where("membership_capabilities.capability", "=", Capabilities.viewStage)
		.where("stage_memberships.userId", "=", userId)

	const communityMemberships = db
		.selectFrom("community_memberships")
		.innerJoin("membership_capabilities", (join) =>
			join
				.onRef("membership_capabilities.role", "=", "community_memberships.role")
				.on("membership_capabilities.type", "=", MembershipType.community)
		)
		.innerJoin("stages", "stages.communityId", "community_memberships.communityId")
		.where("community_memberships.userId", "=", userId)
		.$if(Boolean(communityId), (qb) =>
			qb.where("community_memberships.communityId", "=", communityId!)
		)
		.where("membership_capabilities.capability", "=", Capabilities.viewStage)
		.select(["stages.id as stageId"])

	return db
		.selectFrom(
			db
				.selectFrom(stageMemberships.union(communityMemberships).as("all_access"))
				.select("stageId")
				.as("stageId")
		)
		.distinct()
		.select("stageId")
}

export const getStagesViewableByUser = cache(
	async (
		userId: UsersId,
		communityId: CommunitiesId,
		/* manually supply this when calling outside a community context */
		communitySlug?: string
	) => {
		return autoCache(
			viewableStagesCte({ db, userId, communityId })
				.clearSelect()
				.select((eb) => eb.fn.countAll<number>().as("count")),
			{
				communitySlug,
			}
		)
			.executeTakeFirstOrThrow()
			.then((res) => (res?.count ?? 0) > 0)
	}
)

type CommunityStageProps = {
	communityId: CommunitiesId
	stageId?: StagesId
	// use null if you want to specifically circument the viewableStages CTE
	// eg when fetching stages in a non-user context, such as running an automation
	userId: UsersId | null
}

export type CommunityStageOptions = {
	/* AutomationEvent = "full" and filters by AutomationEvent */
	withAutomations?: StageAutomationSelectOptions
	withMembers?: "count" | "all" | false
}

export const actionConfigDefaultsSelect = <EB extends ExpressionBuilder<any, any>>(eb: EB) => {
	return (
		eb
			.selectFrom("action_config_defaults")
			.whereRef("action_config_defaults.action", "=", "action_instances.action")
			// only select the keys to prevent possibly leaking "secrets"
			.select((eb) =>
				eb.fn
					.coalesce(
						sql<
							string[]
						>`array(select jsonb_object_keys("action_config_defaults"."config"))`,
						sql<string[]>`'{}'::text[]`
					)
					.as("defaultedConfigKeys")
			)
	)
}

export const filterAutomationsByEvent = <
	QB extends SelectQueryBuilder<PublicSchema, "automations", any>,
>(
	qb: QB,
	events: AutomationEvent[]
) => {
	return qb
		.innerJoin("automation_triggers", "automation_triggers.automationId", "automations.id")
		.where("automation_triggers.event", "in", events) as typeof qb
}

// .$if(withAutomations === "count", (qb) =>
// 	qb.select((eb) =>
// 		eb
// 			.selectFrom("automations")
// 			.whereRef("automations.stageId", "=", "stages.id")
// 			.select((eb) =>
// 				eb.fn.count<number>("automations.id").as("automationsCount")
// 			)
// 			.as("actionInstancesCount")
// 	)
// )

export const countAutomations = <EB extends ExpressionBuilder<PublicSchema, "stages">>(
	eb: EB,
	filter: StageAutomationSelectOptions["filter"]
) => {
	return eb
		.selectFrom("automations")
		.whereRef("automations.stageId", "=", "stages.id")
		.select((eb) => eb.fn.countAll<number>().as("automationsCount"))
		.$if(filter !== "all", (qb) => filterAutomationsByEvent(qb, filter as AutomationEvent[]))
		.as("automationsCount")
}

// types are a bit unsafe here, bc that's how kysely works
// if you enconter issues, set the QB to
// SelectQueryBuilder<PublicSchema, keyof PublicSchema, any>
// to debug
export const nestedBaseAutomationsSelect = <EB extends ExpressionBuilder<PublicSchema, "stages">>(
	eb: EB,
	filter: StageAutomationSelectOptions["filter"]
) => {
	return jsonArrayFrom(
		eb
			.selectFrom("automations")
			.whereRef("automations.stageId", "=", "stages.id")
			.selectAll("automations")
			.$if(filter !== "all", (qb) =>
				filterAutomationsByEvent(qb, filter as AutomationEvent[])
			)
	)
}

export const nestedFullAutomationsSelect = <EB extends ExpressionBuilder<PublicSchema, "stages">>(
	eb: EB,
	filter: StageAutomationSelectOptions["filter"]
) => {
	return jsonArrayFrom(
		eb
			.selectFrom("automations")
			.whereRef("automations.stageId", "=", "stages.id")
			.selectAll("automations")
			.select((eb) => [
				jsonArrayFrom(
					eb
						.selectFrom("automation_triggers")
						.selectAll("automation_triggers")
						.whereRef("automation_triggers.automationId", "=", "automations.id")
				)
					.$notNull()
					.as("triggers"),
				jsonArrayFrom(
					eb
						.selectFrom("action_instances")
						.selectAll("action_instances")
						.whereRef("action_instances.automationId", "=", "automations.id")
						.select((eb) =>
							actionConfigDefaultsSelect(eb).as("defaultedActionConfigKeys")
						)
				)
					.$notNull()
					.as("actionInstances"),
				jsonObjectFrom(
					eb
						.selectFrom("automation_condition_blocks")
						.whereRef("automation_condition_blocks.automationId", "=", "automations.id")
						.where("automation_condition_blocks.automationConditionBlockId", "is", null)
						.selectAll("automation_condition_blocks")
						.select(sql.lit<"block">("block").as("kind"))
						.select((eb) =>
							// this function is what recursively builds the condition blocks and conditions
							// defined in prisma/migrations/20251105151740_add_condition_block_items_function/migration.sql
							eb
								.fn<ConditionBlock[]>("get_condition_block_items", [
									"automation_condition_blocks.id",
								])
								.as("items")
						)
				).as("condition"),
			])
			.$if(filter !== "all", (qb) =>
				filterAutomationsByEvent(qb, filter as AutomationEvent[])
			)
	)
}

/**
 * Get all stages the given user has access to
 */
export const getStages = (
	{ communityId, stageId, userId }: CommunityStageProps,
	options: CommunityStageOptions = {}
) => {
	const withAutomations = options.withAutomations ?? { detail: "count", filter: "all" }

	const basicStart = db.selectFrom("stages").selectAll("stages")

	const start = userId
		? (db
				.with("viewableStages", (db) => viewableStagesCte({ db: db, userId, communityId }))
				.selectFrom("stages")
				.selectAll("stages")
				.innerJoin(
					"viewableStages",
					"viewableStages.stageId",
					"stages.id"
				) as typeof basicStart)
		: basicStart

	return autoCache(
		start
			.where("communityId", "=", communityId)
			.$if(Boolean(stageId), (qb) => qb.where("stages.id", "=", stageId!))
			.select((eb) => [
				jsonArrayFrom(
					eb
						.selectFrom("move_constraint")
						.whereRef("move_constraint.stageId", "=", "stages.id")
						.innerJoin("stages as s", "s.id", "move_constraint.destinationId")
						.select(["s.id", "s.name"])
				).as("moveConstraints"),
				jsonArrayFrom(
					eb
						.selectFrom("move_constraint")
						.whereRef("move_constraint.destinationId", "=", "stages.id")
						.innerJoin("stages as s", "s.id", "move_constraint.stageId")
						.select(["s.id", "s.name"])
				).as("moveConstraintSources"),
				eb
					.selectFrom("PubsInStages")
					.select((eb) =>
						eb.fn
							.count<number>("PubsInStages.pubId")
							.filterWhereRef("PubsInStages.stageId", "=", "stages.id")
							.as("pubsCount")
					)
					.as("pubsCount"),
				// TODO: needs to be fancier and include member groups
				eb
					.selectFrom("stage_memberships")
					.select((eb) =>
						eb.fn
							.count("stage_memberships.userId")
							.filterWhereRef("stage_memberships.stageId", "=", "stages.id")
							.as("memberCount")
					)
					.as("memberCount"),
			])
			.$if(withAutomations && withAutomations?.detail === "full", (qb) =>
				qb.select((eb) =>
					nestedFullAutomationsSelect(eb, withAutomations.filter).as("fullAutomations")
				)
			)

			.$if(withAutomations && withAutomations?.detail === "base", (qb) =>
				qb.select((eb) =>
					nestedBaseAutomationsSelect(eb, withAutomations.filter).as("baseAutomations")
				)
			)
			.$if(withAutomations?.detail === "count", (qb) =>
				qb.select((eb) => countAutomations(eb, withAutomations.filter))
			)
			.orderBy("order asc")
	)
}

export type CommunityStage = AutoReturnType<typeof getStages>["executeTakeFirstOrThrow"]

export const movePub = (pubId: PubsId, stageId: StagesId, trx = db) => {
	return autoRevalidate(
		trx
			.with("leave_stage", (db) => db.deleteFrom("PubsInStages").where("pubId", "=", pubId))
			.insertInto("PubsInStages")
			.values([{ pubId, stageId }])
	)
}

export const duplicateStages = async (
	communityId: CommunitiesId,
	stageIds: StagesId[],
	newStageIds: StagesId[]
) => {
	const res = await maybeWithTrx(db, async (trx) => {
		const newStages = await autoRevalidate(
			trx.insertInto("stages").values(
				stageIds.map((oldStageId, idx) => ({
					id: newStageIds[idx],
					communityId,
					name: trx
						.selectFrom("stages")
						.select(sql<string>`'Copy of ' || name`.as("name"))
						.where("id", "=", oldStageId),
					order: "aa",
				}))
			)
		).execute()

		const existingAutomations = await autoCache(
			trx.selectFrom("automations").where("stageId", "in", stageIds).selectAll("automations")
		).execute()

		const duplicateAutomations = await Promise.all(
			existingAutomations.map((automation) =>
				duplicateAutomation(
					automation.id,
					newStageIds[stageIds.indexOf(expect(automation.stageId))],
					trx
				)
			)
		)

		const existingMembers = await autoCache(
			trx
				.selectFrom("stage_memberships")
				.where("stageId", "in", stageIds)
				.selectAll("stage_memberships")
		).execute()

		const duplicateMembers = await autoRevalidate(
			trx
				.insertInto("stage_memberships")
				.values(
					existingMembers.map(({ id, ...member }) => ({
						...member,
						stageId: newStageIds[stageIds.indexOf(member.stageId)],
					}))
				)
				.returningAll()
		).execute()

		return {
			newStages,
			duplicateAutomations,
			duplicateMembers,
		}
	})

	return res
}
