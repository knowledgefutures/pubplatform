import type { ProcessedPub } from "contracts"
import type { Database } from "db/Database"
import type {
	ActionInstancesId,
	ActionRunsId,
	AutomationEvent,
	AutomationRunsId,
	AutomationsId,
	Communities,
	CommunitiesId,
	PubsId,
	StagesId,
	UsersId,
} from "db/public"
import type { BaseActionInstanceConfig, FullAutomation, Json } from "db/types"
import type { Kysely } from "kysely"
import type { User } from "lucia"
import type { run as logRun } from "../log/run"

import { captureException } from "@sentry/nextjs"
import { jsonArrayFrom } from "kysely/helpers/postgres"

import { ActionRunStatus } from "db/public"
import { logger } from "logger"
import { expect } from "utils"
import { tryCatch } from "utils/try-catch"

import {
	type ActionRunResult,
	type AutomationRunResult,
	getActionRunStatusFromResult,
	isActionFailure,
	isActionSuccess,
} from "~/actions/results"
import { db } from "~/kysely/database"
import { getAutomation } from "~/lib/db/queries"
import { env } from "~/lib/env/env"
import { createLastModifiedBy } from "~/lib/lastModifiedBy"
import { ApiError, getPubsWithRelatedValues } from "~/lib/server"
import { getActionConfigDefaults, getAutomationRunById } from "~/lib/server/actions"
import { MAX_STACK_DEPTH } from "~/lib/server/automations"
import { autoRevalidate } from "~/lib/server/cache/autoRevalidate"
import { type CommunityStage, getStages } from "~/lib/server/stages"
import { isClientExceptionOptions } from "~/lib/serverActions"
import { prettifyZodError } from "~/lib/zod"
import { getActionByName } from "../api"
import { ActionConfigBuilder } from "./ActionConfigBuilder"
import { evaluateConditions } from "./evaluateConditions"
import { getActionRunByName } from "./getRuns"
import { buildInterpolationContext } from "./interpolationContext"
import { hasResolver, resolveAutomationInput } from "./resolveAutomationInput"

export type ActionInstanceRunResult = ActionRunResult

export type RunAutomationArgs = {
	automationId: AutomationsId
	scheduledAutomationRunId?: AutomationRunsId
	trigger: {
		event: AutomationEvent
		config: Record<string, unknown> | null
	}
	// overrides when running manually
	manualActionInstancesOverrideArgs: {
		[actionInstanceId: ActionInstancesId]: Record<string, unknown> | null
	} | null
	// when true, skip condition evaluation (requires overrideAutomationConditions capability)
	skipConditionCheck?: boolean
	user: User | null
	stack: AutomationRunsId[]
	communityId: CommunitiesId
	pubId?: PubsId
	json?: Json
}

export type RunActionInstanceArgs = {
	automation: FullAutomation
	automationRun: {
		id: AutomationRunsId
		actionRuns: { id: ActionRunsId; actionInstanceId: ActionInstancesId | null }[]
	}
	community: Communities
	stage: CommunityStage
	actionInstance: FullAutomation["actionInstances"][number]
	/**
	 * extra params passed to the action instance
	 * these are provided when running the action manually
	 */
	manualActionInstanceOverrideArgs: Record<string, unknown> | null
	// stack: ActionRunsId[];
	actionRunId: ActionRunsId
	user: User | null
	pub:
		| ProcessedPub<{
				withPubType: true
				withRelatedPubs: true
				withStage: false
				withValues: true
		  }>
		| undefined
	json: Json | undefined
	stageId: StagesId
}

type AutomationContext = {
	pub: ProcessedPub<{
		withPubType: true
		withRelatedPubs: true
		withStage: false
		withValues: true
	}> | null
	automation: FullAutomation
	community: Communities
	stage: CommunityStage
}

/**
 * load all necessary context for running an automation
 * includes pub data, automation config, community info, and stage details
 */
async function loadAutomationContext(args: {
	automationId: AutomationsId
	pubId?: PubsId
	communityId: CommunitiesId
}): Promise<AutomationContext> {
	const [pub, automation, community] = await Promise.all([
		args.pubId
			? await getPubsWithRelatedValues(
					{ pubId: args.pubId, communityId: args.communityId },
					{
						withPubType: true,
						withRelatedPubs: true,
						withStage: false,
						withValues: true,
						withIncomingRelations: true,
						depth: 3,
					}
				)
			: null,
		getAutomation(args.automationId, { communityId: args.communityId }),
		// query community directly from db instead of using memoized getCommunity
		// to avoid cache issues in tests
		db
			.selectFrom("communities")
			.selectAll()
			.where("id", "=", args.communityId)
			.executeTakeFirst(),
	])

	if (!automation) {
		throw new Error(`Automation ${args.automationId} not found`)
	}

	if (!community) {
		throw new Error(`Community ${args.communityId} not found`)
	}

	const stage = await getStages({
		communityId: args.communityId,
		stageId: expect(automation.stageId, "Can't run automation without a stage"),
		userId: null,
	}).executeTakeFirstOrThrow(() => new Error(`Stage ${automation.stageId} not found`))

	return { pub, automation, community, stage }
}

/**
 * evaluate automation conditions at execution time if required
 * returns null if conditions pass, or an error result if they fail
 */
async function evaluateAutomationConditions(args: {
	automation: FullAutomation
	skipConditionCheck?: boolean
	pub: AutomationContext["pub"]
	json?: Json
	community: Communities
	scheduledAutomationRunId?: AutomationRunsId
	existingAutomationRun: {
		actionRuns: { id: ActionRunsId; actionInstanceId: ActionInstancesId | null; config: any }[]
	} | null
	stack: AutomationRunsId[]
	trigger: { event: AutomationEvent; config: Record<string, unknown> | null }
	user: User | null
	trx: Kysely<Database>
}): Promise<AutomationRunResult | null> {
	if (!args.automation?.condition || args.skipConditionCheck) {
		return null
	}

	const automationTiming = args.automation.conditionEvaluationTiming as string | null | undefined
	const shouldEvaluateNow =
		automationTiming === "onExecution" ||
		automationTiming === "both" ||
		// if no timing is set, default to evaluating at execution time for backwards compatibility
		!automationTiming

	if (!shouldEvaluateNow) {
		return null
	}

	if (!args.automation.stageId) {
		throw new Error("Cannot evaluate conditions for automation without a stage")
	}

	const stage = await getStages({
		communityId: args.community.id,
		stageId: args.automation.stageId,
		userId: null,
	}).executeTakeFirstOrThrow()

	const input = buildInterpolationContext({
		useDummyValues: false,
		env: {
			PUBPUB_URL: env.PUBPUB_URL,
		},
		community: args.community,
		stage,
		automation: args.automation,
		automationRun: {
			id: args.scheduledAutomationRunId ?? ("pending-evaluation" as AutomationRunsId),
		},
		user: args.user ?? null,
		...(args.pub ? { pub: args.pub } : { json: args.json ?? ({} as Json) }),
	})

	const [error, evaluationResult] = await tryCatch(
		evaluateConditions(args.automation.condition, input)
	)

	if (error) {
		if (args.scheduledAutomationRunId && args.existingAutomationRun) {
			await insertAutomationRun(args.trx, {
				automationId: args.automation.id,
				actionRuns: args.existingAutomationRun.actionRuns.map((ar) => ({
					config: ar.config as BaseActionInstanceConfig,
					result: { error: error.message },
					status: ActionRunStatus.failure,
					actionInstanceId: expect(
						ar.actionInstanceId,
						`Action instance id is required for action run ${ar.id} when creating automation run`
					),
					id: ar.id,
				})),
				pubId: args.pub?.id,
				json: args.json,
				communityId: args.community.id,
				stack: args.stack,
				scheduledAutomationRunId: args.scheduledAutomationRunId,
				trigger: args.trigger,
				userId: args.user?.id,
			})
		}

		return {
			success: false,
			title: "Failed to evaluate conditions",
			report: error.message,
			stack: args.stack,
			actionRuns: [],
		}
	}

	if (!evaluationResult.passed) {
		logger.debug("Automation condition not met at execution time", {
			automationId: args.automation.id,
			conditionEvaluationTiming: automationTiming,
			condition: args.automation.condition,
			failureReason: evaluationResult.failureReason,
			failureMessages: evaluationResult.flatMessages,
		})
		return {
			success: false,
			actionRuns: [],
			title: "Automation condition not met",
			report: evaluationResult.flatMessages.map((m) => m.message).join(", "),
			stack: args.stack,
		}
	}

	logger.debug("Automation condition met at execution time", {
		automationId: args.automation.id,
		conditionEvaluationTiming: automationTiming,
	})

	return null
}

/**
 * execute all action instances in an automation sequentially
 * returns results for each action instance
 */
async function executeActionInstances(args: {
	automation: FullAutomation
	automationRun: {
		id: AutomationRunsId
		actionRuns: { id: ActionRunsId; actionInstanceId: ActionInstancesId | null }[]
	}
	community: Communities
	stage: CommunityStage
	pub: AutomationContext["pub"]
	json?: Json
	manualActionInstancesOverrideArgs: RunAutomationArgs["manualActionInstancesOverrideArgs"]
	user: User | null
}): Promise<
	(ActionRunResult & {
		actionInstance: FullAutomation["actionInstances"][number]
		actionRunId: ActionRunsId
	})[]
> {
	const results: (ActionRunResult & {
		actionInstance: FullAutomation["actionInstances"][number]
		actionRunId: ActionRunsId
	})[] = []

	for (const ai of args.automation.actionInstances) {
		const correcspondingActionRun = args.automationRun.actionRuns.find(
			(ar) => ar.actionInstanceId === ai.id
		)
		if (!correcspondingActionRun) {
			throw new Error(`Action run not found for action instance ${ai.id}`)
		}

		const result = await runActionInstance({
			automation: args.automation,
			actionInstance: ai,
			automationRun: args.automationRun,
			actionRunId: correcspondingActionRun.id,
			stageId: expect(args.automation.stageId),
			community: args.community,
			manualActionInstanceOverrideArgs:
				args.manualActionInstancesOverrideArgs?.[ai.id] ?? null,
			json: args.json,
			stage: args.stage,
			pub: args.pub ?? undefined,
			user: args.user,
		})

		logger[result.success === false ? "error" : "info"]({
			msg: "Action instance finished",
			actionInstanceId: ai.id,
			status: result.success ? ActionRunStatus.success : ActionRunStatus.failure,
			result,
		})

		if (result.success === false) {
			results.push({
				success: false,
				title: "Failed to run action",
				error: result.error,
				report: result.report,
				config: result.config,
				actionInstance: ai,
				actionRunId: correcspondingActionRun.id,
			})
			continue
		}

		results.push({
			...result,
			actionInstance: ai,
			actionRunId: correcspondingActionRun.id,
		})
	}

	return results
}

/**
 * run a singular action instance on an automation
 */
const runActionInstance = async (args: RunActionInstanceArgs): Promise<ActionInstanceRunResult> => {
	const action = getActionByName(args.actionInstance.action)
	const pub = args.pub

	const [actionRun, actionDefaults] = await Promise.all([
		getActionRunByName(args.actionInstance.action),
		getActionConfigDefaults(args.community.id, args.actionInstance.action).executeTakeFirst(),
	])

	if (!args.json && !pub) {
		logger.error("No input found", {
			actionInstance: args.actionInstance,
			pub,
			json: args.json,
		})
		return {
			success: false,
			report: "No input found",
			config: args.actionInstance.config as BaseActionInstanceConfig,
		}
	}

	if (!actionRun || !action) {
		logger.error("Action not found", {
			actionInstance: args.actionInstance,
			actionRun,
			action,
		})
		return {
			success: false,
			report: "Action not found",
			config: args.actionInstance.config as BaseActionInstanceConfig,
		}
	}

	const actionConfigBuilder = new ActionConfigBuilder(args.actionInstance.action)
		.withConfig(args.actionInstance.config as Record<string, any>)
		.withOverrides(args.manualActionInstanceOverrideArgs ?? {})
		.withDefaults(actionDefaults?.config as Record<string, any>)
		.validate()
	const mergedConfig = actionConfigBuilder.getMergedConfig()

	const interpolationData = buildInterpolationContext({
		env: {
			PUBPUB_URL: env.PUBPUB_URL,
		},
		community: args.community,
		stage: args.stage,
		automation: {
			...args.automation,
			actionInstances: args.automation.actionInstances.map((ai) =>
				ai.id === args.actionInstance.id ? { ...ai, config: mergedConfig } : ai
			),
		},
		automationRun: args.automationRun,
		user: args.user ?? null,
		...(pub ? { pub, json: args.json } : { json: args.json ?? ({} as Json) }),
	})

	const interpolated = await actionConfigBuilder.interpolate(interpolationData)

	const result = interpolated.validate().getResult()

	if (!result.success) {
		logger.error("Invalid action configuration", {
			// config: result.config,
			error: result.error.message,
			code: result.error.code,
			cause: result.error.zodError,
		})

		const failConfig = interpolated.getResult()
		const resultConfig = failConfig.success ? failConfig.config : args.actionInstance.config

		return {
			success: false,
			title: "Invalid action configuration",
			error: result.error.message,
			report: result.error.zodError
				? prettifyZodError(result.error.zodError)
				: "Something went wrong while validating the action configuration, but no error was provided",
			config: resultConfig,
		}
	}

	const config = result.config

	const lastModifiedBy = createLastModifiedBy({
		actionRunId: args.actionRunId,
	})

	try {
		// just hard cast it to one option so we at least have some typesafety
		const result = await (actionRun as typeof logRun)({
			// FIXME: get rid of any
			config: config as any,
			...(pub ? { pub } : { json: args.json ?? ({} as Record<string, any>) }),
			stageId: args.stageId,
			communityId: args.community.id,
			lastModifiedBy,
			actionRunId: args.actionRunId,
			user: args.user,
			automation: args.automation,
			automationRunId: args.automationRun.id,
			actionInstanceId: args.actionInstance.id,
		})

		if (isActionSuccess(result)) {
			return { ...result, config }
		}

		if (isActionFailure(result)) {
			return { ...result, config }
		}

		// handle legacy ClientExceptionOptions format
		if (isClientExceptionOptions(result)) {
			return {
				success: false,
				title: result.title,
				error: result.cause,
				report: result.error,
				config,
			}
		}

		// handle legacy ActionSuccess format
		return {
			success: true,
			report: result.report,
			data: result.data,
			config,
		}
	} catch (error) {
		captureException(error)
		logger.error(error)

		return {
			success: false,
			title: "Failed to run action",
			report: "Something unexpected happened",
			config: config,
		}
	}
}

/**
 * run an automation with all its action instances
 *
 * NOTE: automation_run.status is automatically computed by the database trigger
 * compute_automation_run_status() when action_runs are inserted/updated.
 * the trigger computes status as the aggregate of all action_runs and emits
 * events for sequential automations when the automation succeeds or fails.
 */
export async function runAutomation(
	args: RunAutomationArgs,
	trx = db
): Promise<AutomationRunResult> {
	if (args.stack.length > MAX_STACK_DEPTH) {
		throw new Error(
			`Action instance stack depth of ${args.stack.length} exceeds the maximum allowed depth of ${MAX_STACK_DEPTH}`
		)
	}

	// load automation context (pub, automation config, community, stage)
	const { pub, automation, community, stage } = await loadAutomationContext({
		automationId: args.automationId,
		pubId: args.pubId,
		communityId: args.communityId,
	})

	// check for disabled actions
	if (
		automation.actionInstances.some((ai) =>
			env.FLAGS?.get("disabled-actions").includes(ai.action)
		)
	) {
		return { ...ApiError.FEATURE_DISABLED, stack: args.stack, actionRuns: [], success: false }
	}

	// load existing automation run if this is a scheduled execution
	const existingAutomationRun = args.scheduledAutomationRunId
		? await getAutomationRunById(
				args.communityId,
				args.scheduledAutomationRunId
			).executeTakeFirstOrThrow(
				() => new Error(`Automation run ${args.scheduledAutomationRunId} not found`)
			)
		: null

	// evaluate conditions at execution time if required
	const conditionResult = await evaluateAutomationConditions({
		automation,
		skipConditionCheck: args.skipConditionCheck,
		pub,
		json: args.json,
		community,
		scheduledAutomationRunId: args.scheduledAutomationRunId,
		existingAutomationRun,
		stack: args.stack,
		trigger: args.trigger,
		user: args.user,
		trx,
	})

	if (conditionResult) {
		return conditionResult
	}

	const isActionUserInitiated = "userId" in args

	// resolve automation input if a resolver is configured
	// this allows the automation to operate on a different pub or transformed json
	// resolved values are additive - they add to or overwrite existing context:
	// - JSON resolved: adds json to context (or overwrites existing json)
	// - Pub resolved: adds pub to context (or overwrites existing pub)
	let resolvedPub = pub
	let resolvedJson = args.json

	if (hasResolver(automation)) {
		const resolverContext = buildInterpolationContext({
			useDummyValues: false,
			env: { PUBPUB_URL: env.PUBPUB_URL },
			community,
			stage,
			automation,
			automationRun: {
				id: args.scheduledAutomationRunId ?? ("pending-resolver" as AutomationRunsId),
			},
			user: args.user ?? null,
			...(pub ? { pub, json: args.json } : { json: args.json ?? ({} as Json) }),
		})

		const resolved = await resolveAutomationInput(
			automation.resolver,
			resolverContext,
			args.communityId,
			community.slug
		)

		if (resolved.type === "pub") {
			// Pub resolved: overwrites existing pub, keeps existing json
			resolvedPub = resolved.pub
			logger.debug("Resolver resolved to a pub", {
				automationId: automation.id,
				originalPubId: pub?.id,
				resolvedPubId: resolved.pub.id,
				hasExistingJson: resolvedJson !== undefined,
			})
		} else if (resolved.type === "json") {
			// JSON resolved: overwrites existing json, keeps existing pub
			resolvedJson = resolved.json
			logger.debug("Resolver resolved to JSON", {
				automationId: automation.id,
				hasExistingPub: resolvedPub !== null,
			})
		}
		// if type is "unchanged", keep the original pub/json
	}

	// create the automation run with scheduled action runs
	// we need to create action runs first in case the action modifies the pub
	// and needs to pass the lastModifiedBy field (action-run:<action-run-id>)
	const automationRun = await insertAutomationRun(trx, {
		automationId: args.automationId,
		actionRuns: automation.actionInstances.map((ai) => ({
			id: existingAutomationRun?.actionRuns.find((ar) => ar.actionInstanceId === ai.id)?.id,
			actionInstanceId: ai.id,
			config: ai.config,
			result: { scheduled: `Action to be run immediately` },
			status: ActionRunStatus.scheduled,
		})),
		pubId: resolvedPub?.id,
		json: resolvedJson as Json,
		communityId: args.communityId,
		stack: args.stack,
		scheduledAutomationRunId: args.scheduledAutomationRunId,
		trigger: args.trigger,
		userId: isActionUserInitiated ? args.user?.id : undefined,
	})

	// execute all action instances sequentially
	const results = await executeActionInstances({
		automation,
		automationRun,
		community,
		stage,
		pub: resolvedPub,
		json: resolvedJson,
		manualActionInstancesOverrideArgs: args.manualActionInstancesOverrideArgs,
		user: isActionUserInitiated ? args.user : null,
	})

	// update automation run with final results
	// NOTE: the database trigger will automatically compute and set the automation_run.status
	// based on the aggregate of all action_run statuses when we update the action_runs here
	const finalAutomationRun = await insertAutomationRun(trx, {
		automationId: args.automationId,
		actionRuns: results.map(({ actionRunId, actionInstance, ...result }) => ({
			id: actionRunId,
			actionInstanceId: actionInstance.id,
			config: result.config,
			status: getActionRunStatusFromResult(result),
			result: result,
		})),
		pubId: resolvedPub?.id,
		json: resolvedJson,
		trigger: args.trigger,
		communityId: args.communityId,
		stack: args.stack,
		scheduledAutomationRunId: automationRun.id,
		userId: isActionUserInitiated ? args.user?.id : undefined,
	})

	const success = results.every((r) => r.success === true)

	if (!success) {
		return {
			success: false,
			title: "Automation run failed",
			report: `${results
				.filter((r) => r.success === false)
				.map((r) => r.report)
				.join(", ")}`,
			stack: [...args.stack, finalAutomationRun.id],
			actionRuns: results,
		}
	}

	return {
		success: true,
		title: "Automation run finished",
		stack: [...args.stack, finalAutomationRun.id],
		actionRuns: results,
	}
}

export async function insertAutomationRun(
	trx: Kysely<Database>,
	args: {
		automationId: AutomationsId
		actionRuns: {
			id?: ActionRunsId
			actionInstanceId: ActionInstancesId
			config: BaseActionInstanceConfig
			result: Record<string, unknown>
			status: ActionRunStatus
		}[]
		pubId?: PubsId
		json?: Json
		trigger: {
			event: AutomationEvent
			config: Record<string, unknown> | null
		}
		communityId: CommunitiesId
		stack: AutomationRunsId[]
		scheduledAutomationRunId?: AutomationRunsId
		userId?: UsersId
	}
) {
	const automatonRun = await autoRevalidate(
		trx
			.with("automationRun", (trx) =>
				trx
					.insertInto("automation_runs")
					.values({
						id: args.scheduledAutomationRunId,
						automationId: args.automationId,
						sourceUserId: args.userId,
						inputJson: args.json,
						inputPubId: args.pubId,
						triggerConfig: args.trigger.config,
						triggerEvent: args.trigger.event,
						sourceAutomationRunId: args.stack.at(-1),
					})
					.returningAll()
					// conflict should only happen if a scheduled action is excecuted
					// not on user initiated actions or on other events
					.onConflict((oc) =>
						oc.column("id").doUpdateSet({
							triggerConfig: args.trigger.config,
							triggerEvent: args.trigger.event,
						})
					)
			)
			.with("actionRuns", (trx) =>
				trx
					.insertInto("action_runs")
					.values((eb) =>
						args.actionRuns.map((ai) => ({
							id: ai.id,
							automationRunId: eb
								.selectFrom("automationRun")
								.select("automationRun.id")
								.where("automationRun.automationId", "=", args.automationId)
								.limit(1),
							actionInstanceId: ai.actionInstanceId,
							pubId: args.pubId,
							json: args.json,
							userId: args.userId,
							config: ai.config,
							event: args.trigger.event,
							status: ai.status,
							result: ai.result,
						}))
					)
					.returningAll()
					// update status and result, and config if it had changed in the meantime
					.onConflict((oc) =>
						oc.column("id").doUpdateSet((eb) => ({
							status: eb.ref("excluded.status"),
							result: eb.ref("excluded.result"),
							config: eb.ref("excluded.config"),
						}))
					)
			)
			.selectFrom("automationRun")
			.selectAll("automationRun")
			.select((eb) =>
				jsonArrayFrom(
					eb
						.selectFrom("actionRuns")
						.selectAll("actionRuns")
						.whereRef("actionRuns.automationRunId", "=", "automationRun.id")
				).as("actionRuns")
			)
	).executeTakeFirstOrThrow()

	return automatonRun
}
