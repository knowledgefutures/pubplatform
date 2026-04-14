"use server"

import type { ActionInstancesId } from "db/public"
import type { RunAutomationArgs } from "../_lib/runAutomation"
import type { AutomationRunResult } from "../results"

import { AutomationEvent, Capabilities, MembershipType } from "db/public"
import { logger } from "logger"

import { getLoginData } from "~/lib/authentication/loginData"
import { userCan } from "~/lib/authorization/capabilities"
import { defineServerAction } from "~/lib/server/defineServerAction"
import { runAutomation } from "../_lib/runAutomation"
import { getActionByName } from "."

export const runAutomationManual = defineServerAction(async function runAutomationManual(
	args: Omit<RunAutomationArgs, "user" | "trigger"> & {
		manualActionInstancesOverrideArgs: {
			[actionInstanceId: ActionInstancesId]: Record<string, unknown>
		}
		skipConditionCheck?: boolean
	}
) {
	const { user } = await getLoginData()

	if (!user) {
		return {
			success: false,
			error: "Not logged in",
			config: {},
		}
	}

	const canRunAction = args.pubId
		? await userCan(
				Capabilities.runAction,
				{ type: MembershipType.pub, pubId: args.pubId },
				user.id
			)
		: // FIXME: (!!!!!) this is a hack to allow actions to be run without a pubId
			// we should instead check whether the user can run the action on the stage
			true

	if (!canRunAction) {
		return {
			success: false,
			error: "Not authorized to run action",
			config: {},
		}
	}

	// verify the user has permission to skip condition checks if requested
	let skipConditionCheck = false
	if (args.skipConditionCheck) {
		const canOverrideConditions = await userCan(
			Capabilities.overrideAutomationConditions,
			{ type: MembershipType.community, communityId: args.communityId },
			user.id
		)
		if (!canOverrideConditions) {
			return {
				success: false,
				error: "Not authorized to skip condition checks",
				config: {},
			}
		}
		skipConditionCheck = true
	}

	const { json: _, pubId: __, ...rest } = args

	const result = await runAutomation({
		...rest,
		user,
		stack: args.stack ?? [],
		communityId: args.communityId,
		manualActionInstancesOverrideArgs: args.manualActionInstancesOverrideArgs,
		skipConditionCheck,
		...(args.json ? { json: args.json } : { pubId: args.pubId! }),
		// manual run
		automationId: args.automationId,
		trigger: {
			event: AutomationEvent.manual,
			config: null,
		},
	})

	if (!result.success) {
		logger.error({ msg: "Automation run failed", result })

		return {
			success: false,
			error: result.actionRuns
				.map((r) => r.success === false && r.error)
				.filter(Boolean)
				.join(", "),
			report: result.report ?? formatReport(result.actionRuns),
			config: result.actionRuns,
		}
	}

	return {
		success: true,
		report: result.report ?? formatReport(result.actionRuns),
		config: result.actionRuns,
	}
})

function formatReport(actionRuns: AutomationRunResult["actionRuns"]) {
	return (
		<ul className="prose-sm dark:prose-invert">
			{actionRuns.map((r) => {
				const action = getActionByName(r.actionInstance.action)

				return (
					<li key={r.actionInstance.id}>
						<strong>{action.niceName}</strong> <br />
						{r.report}
					</li>
				)
			})}
		</ul>
	)
}
