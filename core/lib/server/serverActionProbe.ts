type RequestHeaders = NodeJS.Dict<string | string[]>

export type ServerActionProbeKind = "malformed-server-action" | "unknown-server-action"

/**
 * Stands in for the original error in Sentry, so these requests group into
 * one clearly named issue per kind instead of a pile of raw parse errors.
 * The original error stays attached as `cause`.
 */
export class ServerActionProbeError extends Error {
	readonly kind: ServerActionProbeKind

	constructor(kind: ServerActionProbeKind, message: string, cause: unknown) {
		super(message, { cause })
		this.name =
			kind === "malformed-server-action" ? "MalformedServerAction" : "UnknownServerAction"
		this.kind = kind
	}
}

const header = (headers: RequestHeaders, name: string) => {
	const value = headers[name]
	return Array.isArray(value) ? value[0] : value
}

/**
 * Next treats any POST with a `next-action` header, or a multipart / urlencoded
 * form body, as a possible Server Action call.
 */
const isServerActionRequest = (request: { method: string; headers: RequestHeaders }) => {
	if (request.method !== "POST") {
		return false
	}
	const contentType = header(request.headers, "content-type") ?? ""
	return (
		header(request.headers, "next-action") !== undefined ||
		contentType.startsWith("multipart/form-data") ||
		contentType.startsWith("application/x-www-form-urlencoded")
	)
}

/**
 * Recognizes Server Action requests that failed before any of our code ran:
 * the payload couldn't be decoded, or the action ID doesn't exist. Malformed
 * payloads are almost always vulnerability scanners (React2Shell-style probes);
 * unknown IDs are scanners or tabs left open across a deploy. Returns null for
 * everything else, which should be reported as usual.
 */
export const classifyServerActionProbe = (
	error: unknown,
	request: { path: string; method: string; headers: RequestHeaders }
): ServerActionProbeError | null => {
	if (!(error instanceof Error) || !isServerActionRequest(request)) {
		return null
	}

	if (error.message.startsWith("Failed to find Server Action")) {
		return new ServerActionProbeError(
			"unknown-server-action",
			`POST ${request.path} called a Server Action that doesn't exist (stale tab after a deploy, or a scanner)`,
			error
		)
	}

	if (error instanceof SyntaxError) {
		return new ServerActionProbeError(
			"malformed-server-action",
			`POST ${request.path} sent a Server Action payload that couldn't be decoded (likely a vulnerability scanner)`,
			error
		)
	}

	return null
}

export const serverActionProbeContext = (request: { headers: RequestHeaders }) => ({
	nextAction: header(request.headers, "next-action"),
	contentType: header(request.headers, "content-type"),
	userAgent: header(request.headers, "user-agent"),
	forwardedFor: header(request.headers, "x-forwarded-for"),
})
