import type { Job } from "graphile-worker"
import type { ClientException, ClientExceptionOptions } from "../serverActions"

import { makeWorkerUtils } from "graphile-worker"

import { logger } from "logger"

import { env } from "../env/env"

import "date-fns"

import type { AutomationEvent, AutomationRunsId, AutomationsId, PubsId, StagesId } from "db/public"
import type { Interval } from "~/actions/_lib/triggers"

import { addDuration } from "../dates"

export const getScheduledAutomationJobKey = ({
	stageId,
	automationId,
	pubId,
	trigger,
}: {
	stageId: StagesId
	automationId: AutomationsId
	trigger: {
		event: AutomationEvent
		config: Record<string, unknown> | null
	}
	pubId?: PubsId
}) => `scheduled-automation-${stageId}-${automationId}${pubId ? `-${pubId}` : ""}-${trigger.event}`

export type JobsClient = {
	unscheduleJob(jobKey: string): Promise<void>
	scheduleBackup(options?: {
		backupId?: string
		runAt?: Date
		jobKey?: string
	}): Promise<Job | ClientExceptionOptions>
	scheduleDelayedAutomation(options: {
		automationId: AutomationsId
		stageId: StagesId
		pubId: PubsId
		duration: number
		interval: Interval
		community: {
			slug: string
		}
		trigger: {
			event: AutomationEvent
			config: Record<string, unknown> | null
		}
		stack: AutomationRunsId[]
		scheduledAutomationRunId: AutomationRunsId
	}): Promise<Job | ClientExceptionOptions>
}

export const makeJobsClient = async (): Promise<JobsClient> => {
	const workerUtils = await makeWorkerUtils({
		connectionString: env.DATABASE_URL,
	})
	await workerUtils.migrate()
	return {
		async unscheduleJob(jobKey: string) {
			logger.info({ msg: `Unscheduling job with key: ${jobKey}`, job: { key: jobKey } })
			await workerUtils.withPgClient(async (pg) => {
				await pg.query(`SELECT graphile_worker.remove_job($1);`, [jobKey])
			})

			logger.info({
				msg: `Successfully unscheduled job with key: ${jobKey}`,
				job: { key: jobKey },
			})
		},
		async scheduleBackup(options) {
			const backupId = options?.backupId
			const runAt = options?.runAt
			const jobKey = options?.jobKey

			try {
				const job = await workerUtils.addJob(
					"createBackup",
					{
						...(backupId ? { backupId } : {}),
					},
					{
						...(runAt ? { runAt } : {}),
						...(jobKey
							? {
									jobKey,
									jobKeyMode: "replace",
								}
							: {}),
					}
				)

				logger.info({
					msg: "Successfully scheduled backup job",
					backupId,
					runAt,
					jobId: job.id,
				})

				return job
			} catch (err) {
				logger.error({
					msg: "Error scheduling backup job",
					backupId,
					runAt,
					err: err instanceof Error ? err.message : String(err),
				})

				return {
					error: err,
				} as ClientException
			}
		},
		async scheduleDelayedAutomation({
			automationId,
			stageId,
			pubId,
			duration,
			interval,
			community,
			trigger,
			stack,
			scheduledAutomationRunId,
		}) {
			const runAt = addDuration({ duration, interval })
			const jobKey = getScheduledAutomationJobKey({
				stageId,
				automationId,
				pubId,
				trigger,
			})

			logger.info({
				msg: `Scheduling delayed automation ${automationId} to run at ${runAt}`,
				automationId,
				stageId,
				pubId,
				duration,
				interval,
				trigger,
				runAt,
				stack,
				scheduledAutomationRunId,
			})
			try {
				const job = await workerUtils.addJob(
					"emitEvent",
					{
						type: "RunDelayedAutomation",
						automationId,
						pubId,
						stageId,
						trigger,
						community,
						stack,
						automationRunId: scheduledAutomationRunId,
					},
					{
						runAt,
						jobKey,
						jobKeyMode: "replace",
					}
				)

				logger.info({
					msg: `Successfully scheduled delayed automation ${automationId} to run at ${runAt}`,
					automationId,
					stageId,
					pubId,
					runAt,
				})
				return job
			} catch (err) {
				logger.error({
					msg: `Error scheduling delayed automation ${automationId}`,
					automationId,
					stageId,
					pubId,
					err: err.message,
					stack,
					trigger,
				})
				return {
					error: err,
				} as ClientException
			}
		},
	}
}

let jobsClient: JobsClient

export const getJobsClient = async () => {
	if (!jobsClient) {
		jobsClient = await makeJobsClient()
	}
	return jobsClient
}
