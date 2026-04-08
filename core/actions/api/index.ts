// shared actions between server and client

import * as buildSite from "../buildSite/action"
import * as createPub from "../createPub/action"
import * as datacite from "../datacite/action"
import * as email from "../email/action"
import * as googleDriveImport from "../googleDriveImport/action"
import * as http from "../http/action"
import * as log from "../log/action"
import * as move from "../move/action"

export const actions = {
	[log.action.name]: log.action,
	[email.action.name]: email.action,
	[http.action.name]: http.action,
	[move.action.name]: move.action,
	[googleDriveImport.action.name]: googleDriveImport.action,
	[datacite.action.name]: datacite.action,
	[createPub.action.name]: createPub.action,
	[buildSite.action.name]: buildSite.action,
} as const

export const getActionByName = <N extends keyof typeof actions>(name: N) => {
	if (!(name in actions)) {
		throw new Error(`Action ${name} not found`)
	}

	return actions[name]
}

export const getActionNames = () => {
	return Object.keys(actions) as (keyof typeof actions)[]
}
