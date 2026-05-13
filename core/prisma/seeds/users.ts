import type { UsersId } from "db/public"

import { MemberRole } from "db/public"

const adminBase = {
	id: "0cd4b908-b4f6-41be-9463-28979fefb4cd" as UsersId,
	role: MemberRole.admin,
} as const

const editorBase = {
	id: "5973c4af-da36-48d2-848c-97bc45f186a1" as UsersId,
	role: MemberRole.editor,
} as const

const contributorBase = {
	id: "a54fd9b7-7d8f-43c9-bc00-400652a118c0" as UsersId,
	role: MemberRole.contributor,
} as const

export const usersNew = {
	admin: {
		...adminBase,
		email: "all@pubstar.org",
		password: "pubstar-all",
		slug: "all",
		firstName: "Jill",
		lastName: "Admin",
		isSuperAdmin: true,
		avatar: "/demo/person.png",
		// prismaCommunityIds,
		isVerified: true,
	},
	editor: {
		...editorBase,
		email: "some@pubstar.org",
		password: "pubstar-some",
		slug: "some",
		firstName: "Jack",
		lastName: "Editor",
		isSuperAdmin: false,
		// prismaCommunityIds,
		isVerified: true,
	},
	contributor: {
		...contributorBase,
		email: "none@pubstar.org",
		password: "pubstar-none",
		slug: "none",
		firstName: "Jenna",
		lastName: "Contributor",
		isSuperAdmin: false,
		isVerified: true,
	},
} as const

export const usersExisting = {
	admin: {
		...adminBase,
		existing: true,
	},
	editor: {
		...editorBase,
		existing: true,
	},
	contributor: {
		...contributorBase,
		existing: true,
	},
} as const
