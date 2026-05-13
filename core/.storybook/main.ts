import type { StorybookConfig } from "@storybook/nextjs-vite"

import { dirname, join } from "node:path"

/**
 * This function is used to resolve the absolute path of a package.
 * It is needed in projects that use Yarn PnP or are set up within a monorepo.
 */
function getAbsolutePath(value: string): string {
	return dirname(require.resolve(join(value, "package.json")))
}
const config: StorybookConfig = {
	stories: ["../stories/**/*.mdx", "../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
	addons: [
		getAbsolutePath("@storybook/addon-onboarding"),
		// getAbsolutePath("@chromatic-com/storybook"),
		getAbsolutePath("@storybook/addon-vitest"),
		getAbsolutePath("@storybook/addon-docs"),
	],
	core: {},
	framework: {
		name: getAbsolutePath("@storybook/nextjs-vite"),
		options: {},
	},
	features: {
		experimentalRSC: true,
	},
	staticDirs: ["../public"],
	env: (env) => {
		return {
			...env,
			// these options are not propogated to the client i think
			SKIP_VALIDATION: "true",
			PUBSTAR_URL: "http://localhost:6006",
		}
	},
	// this causes and error: `expected expression, got reserved word 'enum'`
	// typescript: {
	// 	reactDocgen: "react-docgen-typescript",
	// },
	viteFinal: async (config) => {
		config.resolve = config.resolve || {}

		if (config.resolve) {
			config.resolve.alias = [
				// might be able to consolidate these
				{
					find: /.*pubeditor.*actions(.ts)?$/i,
					replacement: new URL("./__mocks__/PubEditor.actions.mock.ts", import.meta.url)
						.pathname,
				},
				{
					find: /.*stages.*actions(.ts)?$/i,
					replacement: new URL("./__mocks__/Stages.actions.mock.ts", import.meta.url)
						.pathname,
				},
				{
					find: /.*serverAction(.ts)?$/,
					replacement: new URL("./__mocks__/runActionInstance.mock.ts", import.meta.url)
						.pathname,
				},
				// server-only is already mocked by storybook
				{
					find: /.*server\/pubFields$/,
					replacement: new URL("./__mocks__/pubFields.mock.ts", import.meta.url).pathname,
				},
				// necessary bc Storybook is treated as a client side app, and otherwise validation fails in annoying ways
				{
					find: /.*env\/env$/,
					replacement: new URL("./__mocks__/env.mock.ts", import.meta.url).pathname,
				},
			]
		}
		return config
	},
}
export default config
