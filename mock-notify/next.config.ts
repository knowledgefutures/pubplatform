import type { NextConfig } from "next"

const nextConfig: NextConfig = {
	reactStrictMode: true,
	basePath: process.env.BASE_PATH || "",
}

export default nextConfig
