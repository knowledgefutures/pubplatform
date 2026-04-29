import type { AppConfig } from "~/lib/urls"

import { HomeClient } from "./components/HomeClient"

const basePath = process.env.BASE_PATH || ""

export const dynamic = "force-dynamic"

export default function Page() {
	const pubpubUrl = process.env.PUBSTAR_URL || "http://localhost:3000"

	const selfUrl = basePath
		? `${pubpubUrl}${basePath}`
		: `http://localhost:${process.env.PORT || "4001"}`

	const config: AppConfig = { pubpubUrl, selfUrl }

	return <HomeClient config={config} />
}
