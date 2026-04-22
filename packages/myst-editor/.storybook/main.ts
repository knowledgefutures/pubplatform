import type { StorybookConfig } from "@storybook/react-vite"

import { dirname, join } from "node:path"

function getAbsolutePath(value: string): any {
	return dirname(require.resolve(join(value, "package.json")))
}
const config: StorybookConfig = {
	stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
	addons: [
		getAbsolutePath("@storybook/addon-links"),
		getAbsolutePath("@chromatic-com/storybook"),
		getAbsolutePath("@storybook/addon-docs"),
	],
	framework: {
		name: getAbsolutePath("@storybook/react-vite"),
		options: {},
	},
}
export default config
