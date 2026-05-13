import { env } from "~/lib/env/env"

export const createRedirectUrl = (redirectTo: string, searchParams?: Record<string, string>) => {
	// it's a full url, just redirect them there
	if (URL.canParse(redirectTo)) {
		const url = new URL(redirectTo)
		Object.entries(searchParams ?? {}).forEach(([key, value]) => {
			url.searchParams.append(key, value)
		})

		return url
	}

	if (URL.canParse(redirectTo, env.PUBSTAR_URL)) {
		const url = new URL(redirectTo, env.PUBSTAR_URL)

		Object.entries(searchParams ?? {}).forEach(([key, value]) => {
			url.searchParams.append(key, value)
		})

		return url
	}

	// invalid redirectTo, redirect to not-found
	return new URL(`/not-found?from=${encodeURIComponent(redirectTo)}`, env.PUBSTAR_URL)
}
