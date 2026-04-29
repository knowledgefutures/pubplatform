import type { env as envOriginal } from "~/lib/env/env"

export const env = {
	PUBSTAR_URL: "http://localhost:6006",
} satisfies Partial<typeof envOriginal>
