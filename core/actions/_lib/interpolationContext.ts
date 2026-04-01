import type { ProcessedPub } from "contracts"
import type {
	ActionInstances,
	AutomationRuns,
	AutomationRunsId,
	Automations,
	AutomationsId,
	Communities,
	StagesId,
	Users,
} from "db/public"
import type { FullAutomation, Json } from "db/types"
import type { CommunityStage } from "~/lib/server/stages"

import { type IncomingRelations, createPubProxy } from "./pubProxy"

export type InterpolationContextBase = {
	community: InterpolationCommunity
	stage: InterpolationStage
	automation: InterpolationAutomation
	automationRun: InterpolationAutomationRun
	user: InterpolationUser | null
	env: InterpolationEnv
}

export type InterpolationContext = InterpolationContextBase & {
	pub?: ReturnType<typeof createPubProxy>
	json?: Json
	site?: { base: string }
}

type InterpolationCommunity = Pick<Communities, "id" | "name" | "slug" | "avatar">

type InterpolationStage = Pick<CommunityStage, "id" | "name">

type InterpolationAutomation = Pick<Automations, "id" | "name"> & {
	actions: InterpolationAction[]
}

type InterpolationAutomationRun = Pick<AutomationRuns, "id">

type InterpolationAction = Pick<ActionInstances, "id" | "action" | "config">

type InterpolationUser = Pick<Users, "id" | "firstName" | "lastName" | "email">

type InterpolationEnv = {
	PUBPUB_URL: string
}

type BuildInterpolationContextArgsBase = {
	stage: Pick<CommunityStage, "id" | "name">
	automation: FullAutomation
	automationRun: InterpolationAutomationRun
	user: InterpolationUser | null
	incomingRelations?: IncomingRelations
}

type BuildInterpolationContextArgs =
	| (BuildInterpolationContextArgsBase &
			({
				community: InterpolationCommunity
				env: InterpolationEnv
				useDummyValues?: false
			} & (
				| {
						pub: ProcessedPub
						json?: Json
				  }
				| {
						pub?: never
						json: Json
				  }
			)))
	| (Partial<BuildInterpolationContextArgsBase> &
			({
				community: InterpolationCommunity
				env: InterpolationEnv
				useDummyValues: true
			} & (
				| {
						pub: ProcessedPub
						json?: Json
				  }
				| {
						pub?: never
						json: Json
				  }
			)))

/**
 * build interpolation context for jsonata templates
 * provides consistent data structure across all interpolation points
 */
export function buildInterpolationContext(
	args: BuildInterpolationContextArgs
): InterpolationContext {
	const baseContext: Omit<InterpolationContext, "json" | "pub" | "site"> = {
		env: {
			PUBPUB_URL: args.env.PUBPUB_URL,
		},
		community: {
			id: args.community.id,
			name: args.community.name,
			avatar: args.community.avatar,
			slug: args.community.slug,
		},
		stage: args.stage
			? {
					id: args.stage.id,
					name: args.stage.name,
				}
			: {
					id: "dummy-stage-id" as StagesId,
					name: "Dummy Stage",
				},
		automation: args.automation
			? {
					id: args.automation.id,
					name: args.automation.name,
					actions: args.automation.actionInstances,
				}
			: {
					id: "<dummy-automation-id>" as AutomationsId,
					name: "Dummy Automation",
					actions: [],
				},
		automationRun: args.automationRun
			? {
					id: args.automationRun.id,
				}
			: {
					id: "<dummy-automation-run-id>" as AutomationRunsId,
				},
		user: args.user
			? {
					id: args.user.id,
					firstName: args.user.firstName,
					lastName: args.user.lastName,
					email: args.user.email,
				}
			: null,
	}

	if (args.pub && args.json !== undefined) {
		// Both pub and json provided
		return {
			...baseContext,
			pub: createPubProxy(args.pub, args.community.slug, args.incomingRelations),
			json: args.json,
		}
	}

	if (args.pub) {
		return {
			...baseContext,
			pub: createPubProxy(args.pub, args.community.slug, args.incomingRelations),
		}
	}

	return {
		...baseContext,
		json: args.json,
	}
}
