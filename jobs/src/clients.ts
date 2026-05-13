import { initClient } from "@ts-rest/core"

import { api } from "contracts"

export const internalClient = initClient(api.internal, {
	baseUrl: `${process.env.PUBSTAR_URL}`,
	baseHeaders: { authorization: `Bearer ${process.env.API_KEY}` },
	jsonQuery: true,
})

export type InternalClient = typeof internalClient

export const clients = {
	internalClient,
} as const

export type Clients = typeof clients
export type Client = Clients[keyof Clients]
