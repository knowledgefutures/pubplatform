import type { InstrumentationOnRequestError } from "next/dist/server/instrumentation/types"

import * as Sentry from "@sentry/nextjs"

import { classifyServerActionProbe, serverActionProbeContext } from "./lib/server/serverActionProbe"

export const onRequestError: InstrumentationOnRequestError = (error, request, context) => {
	const probe = classifyServerActionProbe(error, request)
	if (!probe) {
		return Sentry.captureRequestError(error, request, context)
	}

	// group each kind into a single warning-level issue, filterable with probe:<kind>
	Sentry.withScope((scope) => {
		scope.setLevel("warning")
		scope.setFingerprint([probe.kind])
		scope.setTag("probe", probe.kind)
		scope.setContext("probe", serverActionProbeContext(request))
		Sentry.captureRequestError(probe, request, context)
	})
}
