import type { NextConfig } from "next"

const basePath = process.env.BASE_PATH || ""

const nextConfig: NextConfig = {
	reactStrictMode: true,
	basePath,
	output: "standalone",
	env: {
		NEXT_PUBLIC_BASE_PATH: basePath,
	},
}

export default nextConfig
