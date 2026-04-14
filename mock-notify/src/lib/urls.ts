const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ""

/** prefix a path with the app's basePath for client-side fetch calls */
export const apiUrl = (path: string) => `${basePath}${path}`

export interface AppConfig {
	pubpubUrl: string
	selfUrl: string
}
