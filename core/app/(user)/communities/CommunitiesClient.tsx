"use client"

import type { TableCommunity } from "./getCommunityTableColumns"

import * as React from "react"

import { AddCommunity } from "./AddCommunityDialog"
import { CommunityTable } from "./CommunityTable"

type CommunitiesClientProps = {
	communities: TableCommunity[]
}

export const CommunitiesClient = ({ communities }: CommunitiesClientProps) => {
	const [templateForCopy, setTemplateForCopy] = React.useState<string | undefined>()
	const [dialogKey, setDialogKey] = React.useState(0)

	const handleCreateCopy = React.useCallback((template: string) => {
		setTemplateForCopy(template)
		// increment key to force re-mount of AddCommunity with new template
		setDialogKey((k) => k + 1)
	}, [])

	return (
		<>
			<CommunityTable
				communities={communities}
				onCreateCopy={handleCreateCopy}
			/>
			{templateForCopy && (
				<AddCommunity key={dialogKey} initialTemplate={templateForCopy} />
			)}
		</>
	)
}
