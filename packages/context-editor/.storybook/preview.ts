import type { Preview } from "@storybook/react"

import "@pubpub/tailwind/style.css"
import "../src/tailwind.css"
import "../src/style.css"

const preview: Preview = {
	parameters: {
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
	},
}

export default preview
