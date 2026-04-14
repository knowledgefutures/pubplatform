import { initContract } from "@ts-rest/core"

import { internalApi } from "./resources/internal"
import { siteApi } from "./resources/site"

export * from "./pub-proxy"
export * from "./resources/internal"
export * from "./resources/site"
export * from "./resources/types"

const contract = initContract()

export const api = contract.router({
	/**
	 * internal API for triggering actions etc
	 */
	internal: internalApi,
	/**
	 * Site builder API
	 */
	site: siteApi,
})
