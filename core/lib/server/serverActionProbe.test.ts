import { describe, expect, test } from "vitest"

import { classifyServerActionProbe } from "./serverActionProbe"

const parseError = () => {
	try {
		JSON.parse('{"then":"$1"x}')
	} catch (error) {
		return error
	}
	throw new Error("expected JSON.parse to throw")
}

const actionRequest = (headers: Record<string, string> = {}) => ({
	path: "/login",
	method: "POST",
	headers: { "next-action": "x", "content-type": "text/plain;charset=UTF-8", ...headers },
})

describe("classifyServerActionProbe", () => {
	test("flags an undecodable Server Action payload", () => {
		const probe = classifyServerActionProbe(parseError(), actionRequest())

		expect(probe?.kind).toBe("malformed-server-action")
		expect(probe?.name).toBe("MalformedServerAction")
		expect(probe?.message).toContain("POST /login")
		expect(probe?.cause).toBeInstanceOf(SyntaxError)
	})

	test("flags a multipart form post without a next-action header", () => {
		const probe = classifyServerActionProbe(parseError(), {
			path: "/login",
			method: "POST",
			headers: { "content-type": "multipart/form-data; boundary=x" },
		})

		expect(probe?.kind).toBe("malformed-server-action")
	})

	test("flags an unknown Server Action ID", () => {
		const probe = classifyServerActionProbe(
			new Error(
				"Failed to find Server Action. This request might be from an older or newer deployment."
			),
			actionRequest()
		)

		expect(probe?.kind).toBe("unknown-server-action")
	})

	test("leaves other errors in Server Actions alone", () => {
		expect(classifyServerActionProbe(new Error("database is down"), actionRequest())).toBeNull()
	})

	test("leaves parse errors outside Server Actions alone", () => {
		expect(
			classifyServerActionProbe(parseError(), { path: "/login", method: "GET", headers: {} })
		).toBeNull()
		expect(
			classifyServerActionProbe(parseError(), {
				path: "/api/v0/pubs",
				method: "POST",
				headers: { "content-type": "application/json" },
			})
		).toBeNull()
	})
})
