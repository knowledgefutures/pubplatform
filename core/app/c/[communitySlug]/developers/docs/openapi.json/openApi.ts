import type { AppRoute, AppRouter } from "@ts-rest/core"
import type { OpenAPIObject } from "openapi3-ts/oas30"

import { isAppRoute } from "@ts-rest/core"
import { generateOpenApi } from "@ts-rest/open-api"

import { siteApi } from "contracts"

import { env } from "~/lib/env/env"

type TraverseContractResult = "SKIP" | "CONTINUE" | "STOP"

const traverseContract = (
	contract: AppRouter | AppRoute,
	fn: (contract: AppRoute) => TraverseContractResult | void
) => {
	for (const route in contract) {
		if (isAppRoute(contract)) {
			const x = fn(contract)
			if (x === "STOP") {
				break
			}
			continue
		}
		traverseContract(contract[route], fn)
	}
}

export const createOpenApiDocument = (communitySlug?: string): OpenAPIObject => {
	if (communitySlug) {
		traverseContract(siteApi, (route) => {
			route.path = route.path.replace(/:communitySlug/g, communitySlug)
		})
	}

	return generateOpenApi(siteApi, {
		openapi: "3.0.0",
		info: {
			title: "PubPub Site building API",
			summary: "Endpoints for PubPub",
			description: "",
			contact: {
				name: "PubPub",
				url: "https://help.pubpub.org",
				email: "hello@pubstar.org",
			},
			license: {
				name: "GPL v2.0+",
				url: "https://raw.githubusercontent.com/pubpub/platform/refs/heads/main/LICENSE",
			},
			version: "0.0",
		},
		servers: [
			{
				url: "http://localhost:3000/",
				description: "The development API server",
			},
			{
				url: env.PUBSTAR_URL,
				description: "The production API server",
			},
		],
	})
}
