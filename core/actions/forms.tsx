import type { ComponentType } from "react"

import dynamic from "next/dynamic"

import { Action } from "db/public"
import { Skeleton } from "ui/skeleton"

const toDynamic = (path: string): ComponentType<{}> =>
	dynamic(() => import(`./${path}/form.tsx`), {
		ssr: false,
		loading: () => <Skeleton className="h-64 w-full" />,
	})

const map: Record<Action, ComponentType<{}>> = {
	[Action.datacite]: toDynamic("datacite"),
	[Action.email]: toDynamic("email"),
	[Action.googleDriveImport]: toDynamic("googleDriveImport"),
	[Action.http]: toDynamic("http"),
	[Action.log]: toDynamic("log"),
	[Action.move]: toDynamic("move"),
	[Action.createPub]: toDynamic("createPub"),
	[Action.buildSite]: toDynamic("buildSite"),
}

export function getActionFormComponent(action: Action): ComponentType<{}> {
	return map[action]
}
