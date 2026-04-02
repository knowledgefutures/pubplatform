import * as z from "zod"

import { Action } from "db/public"
import { MoveHorizontal } from "ui/icon"

import { stage } from "../_lib/zodTypes"
import { defineAction } from "../types"

export const action = defineAction({
	name: Action.move,
	niceName: "Move Pub",
	accepts: ["pub"],
	config: {
		schema: z.object({
			stage: stage().describe("The stage the pub will be moved into"),
		}),
	},
	description: "Move a pub into a different stage",
	icon: MoveHorizontal,
})

// is this field a weak ref to foreignkey?
// is this field sensitive/should not be copied?
//
