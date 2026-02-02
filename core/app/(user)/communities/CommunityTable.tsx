"use client"

import type { TableCommunity } from "./getCommunityTableColumns"

import * as React from "react"

import { DataTable } from "~/app/components/DataTable/DataTable"
import { getCommunityTableColumns } from "./getCommunityTableColumns"

type CommunityTableProps = {
	communities: TableCommunity[]
	onCreateCopy?: (template: string) => void
}

export const CommunityTable = ({ communities, onCreateCopy }: CommunityTableProps) => {
	const communityTableColumns = React.useMemo(
		() => getCommunityTableColumns({ onCreateCopy }),
		[onCreateCopy]
	)

	return <DataTable columns={communityTableColumns} data={communities} searchBy="slug" />
}
