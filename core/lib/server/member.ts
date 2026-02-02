import type {
	CommunitiesId,
	CommunityMembershipsId,
	FormsId,
	NewCommunityMemberships,
	NewPubMemberships,
	NewStageMemberships,
	PubMembershipsId,
	PubsId,
	StageMembershipsId,
	StagesId,
	UsersId,
} from "db/public"
import type { OnConflictBuilder } from "kysely"
import type { XOR } from "utils/types"

import { jsonObjectFrom } from "kysely/helpers/postgres"

import { MemberRole } from "db/public"

import { db } from "~/kysely/database"
import { autoCache } from "./cache/autoCache"
import { autoRevalidate } from "./cache/autoRevalidate"
import { SAFE_USER_SELECT } from "./user"

/**
 * Either get a membership by its community membership id, or all memberships by userId and communityId
 * TODO: this should probably return a user with the community memberships attached
 */
export const selectCommunityMemberships = (
	props: XOR<{ id: CommunityMembershipsId }, { userId: UsersId; communityId: CommunitiesId }>,
	trx = db
) => {
	return autoCache(
		trx
			.selectFrom("community_memberships")
			.select((eb) => [
				"community_memberships.id",
				"community_memberships.userId",
				"community_memberships.createdAt",
				"community_memberships.updatedAt",
				"community_memberships.role",
				"community_memberships.communityId",
				"community_memberships.formId",
				jsonObjectFrom(
					eb
						.selectFrom("users")
						.select(SAFE_USER_SELECT)
						.whereRef("users.id", "=", "community_memberships.userId")
				)
					.$notNull()
					.as("user"),
			])
			.$if(Boolean(props.userId), (eb) =>
				eb
					.where("community_memberships.userId", "=", props.userId!)
					.$narrowType<{ userId: UsersId }>()
			)
			.$if(Boolean(props.communityId), (eb) =>
				eb.where("community_memberships.communityId", "=", props.communityId!)
			)
			.$if(Boolean(props.id), (eb) => eb.where("community_memberships.id", "=", props.id!))
	)
}

export const selectAllCommunityMemberships = (
	{ communityId }: { communityId: CommunitiesId },
	trx = db
) =>
	autoCache(
		trx
			.selectFrom("community_memberships")
			.select((eb) => [
				"community_memberships.id",
				"community_memberships.userId",
				"community_memberships.createdAt",
				"community_memberships.updatedAt",
				"community_memberships.role",
				"community_memberships.communityId",
				"community_memberships.formId",
				jsonObjectFrom(
					eb
						.selectFrom("users")
						.select(SAFE_USER_SELECT)
						.whereRef("users.id", "=", "community_memberships.userId")
				)
					.$notNull()
					.as("user"),
			])
			.where("community_memberships.communityId", "=", communityId)
	)

export const selectStageMemberships = (
	props: XOR<{ id: StageMembershipsId }, { userId: UsersId; stageId: StagesId }>,
	trx = db
) => {
	return autoCache(
		trx
			.selectFrom("stage_memberships")
			.select((eb) => [
				"stage_memberships.id",
				"stage_memberships.userId",
				"stage_memberships.createdAt",
				"stage_memberships.updatedAt",
				"stage_memberships.role",
				"stage_memberships.stageId",
				"stage_memberships.formId",
				jsonObjectFrom(
					eb
						.selectFrom("users")
						.select(SAFE_USER_SELECT)
						.whereRef("users.id", "=", "stage_memberships.userId")
				)
					.$notNull()
					.as("user"),
			])
			.$if(Boolean(props.userId), (eb) =>
				eb
					.where("stage_memberships.userId", "=", props.userId!)
					.$narrowType<{ userId: UsersId }>()
			)
			.$if(Boolean(props.stageId), (eb) =>
				eb.where("stage_memberships.stageId", "=", props.stageId!)
			)
			.$if(Boolean(props.id), (eb) => eb.where("stage_memberships.id", "=", props.id!))
	)
}

export const selectPubMemberships = (
	props: XOR<{ id: PubMembershipsId }, { userId: UsersId; pubId: PubsId }>,
	trx = db
) => {
	return autoCache(
		trx
			.selectFrom("pub_memberships")
			.select((eb) => [
				"pub_memberships.id",
				"pub_memberships.userId",
				"pub_memberships.createdAt",
				"pub_memberships.updatedAt",
				"pub_memberships.role",
				"pub_memberships.pubId",
				"pub_memberships.formId",
				jsonObjectFrom(
					eb
						.selectFrom("users")
						.select(SAFE_USER_SELECT)
						.whereRef("users.id", "=", "pub_memberships.userId")
				)
					.$notNull()
					.as("user"),
			])
			.$if(Boolean(props.userId), (eb) =>
				eb
					.where("pub_memberships.userId", "=", props.userId!)
					.$narrowType<{ userId: UsersId }>()
			)
			.$if(Boolean(props.pubId), (eb) => eb.where("pub_memberships.pubId", "=", props.pubId!))
			.$if(Boolean(props.id), (eb) => eb.where("pub_memberships.id", "=", props.id!))
	)
}

const getMembershipRows = <T extends { role: MemberRole; forms: FormsId[]; userId: UsersId }>({
	forms,
	...membership
}: T) => {
	return forms.length ? forms.map((formId) => ({ ...membership, formId })) : [{ ...membership }]
}

export const insertCommunityMemberships = (
	membership: Omit<NewCommunityMemberships, "formId"> & { userId: UsersId; forms: FormsId[] },
	trx = db
) =>
	autoRevalidate(
		trx.insertInto("community_memberships").values(getMembershipRows(membership)).returningAll()
	)

export const deleteCommunityMemberships = (
	{ userId, communityId }: { userId: UsersId; communityId: CommunitiesId },
	trx = db
) =>
	autoRevalidate(
		trx
			.deleteFrom("community_memberships")
			.using("users")
			.whereRef("users.id", "=", "community_memberships.userId")
			.where("users.id", "=", userId)
			.where("community_memberships.communityId", "=", communityId)
			.returningAll()
	)

export const deletePubMemberships = (
	{ userId, pubId }: { userId: UsersId; pubId: PubsId },
	trx = db
) =>
	autoRevalidate(
		trx
			.deleteFrom("pub_memberships")
			.using("users")
			.whereRef("users.id", "=", "pub_memberships.userId")
			.where("users.id", "=", userId)
			.where("pub_memberships.pubId", "=", pubId)
			.returningAll()
	)

export const deleteCommunityMember = (props: CommunityMembershipsId, trx = db) =>
	autoRevalidate(trx.deleteFrom("community_memberships").where("id", "=", props).returningAll())

export const onConflictOverrideRole = (
	oc: OnConflictBuilder<any, any>,
	type: "community" | "pub" | "stage",
	withForm: boolean
) => {
	return oc
		.columns(["userId", `${type}Id`, "formId"])
		.where("formId", withForm ? "is not" : "is", null)
		.doUpdateSet((eb) => ({
			role: eb
				.case()
				.when(eb.ref(`${type}_memberships.role`), "=", MemberRole.admin)
				.then(eb.ref(`${type}_memberships.role`))
				.when(
					eb.and([
						eb(eb.ref(`${type}_memberships.role`), "=", MemberRole.editor),
						eb(eb.ref("excluded.role"), "!=", MemberRole.admin),
					])
				)
				.then(eb.ref(`${type}_memberships.role`))
				.else(eb.ref("excluded.role"))
				.end(),
		}))
}

export const insertCommunityMembershipsOverrideRole = (
	props: NewCommunityMemberships & { userId: UsersId; forms: FormsId[] },
	trx = db
) =>
	autoRevalidate(
		insertCommunityMemberships(props, trx).qb.onConflict((oc) =>
			onConflictOverrideRole(oc, "community", props.formId !== null)
		)
	)

export const insertStageMemberships = (
	membership: NewStageMemberships & { userId: UsersId; forms: FormsId[] },
	trx = db
) =>
	autoRevalidate(
		trx.insertInto("stage_memberships").values(getMembershipRows(membership)).returningAll()
	)

export const deleteStageMemberships = (
	params: { communityId: CommunitiesId; userId: UsersId },
	trx?: typeof db
) => {
	const executor = trx ?? db
	return autoRevalidate(
		executor
			.deleteFrom("stage_memberships")
			.where("stage_memberships.userId", "=", params.userId)
			.where(
				"stage_memberships.stageId",
				"in",
				executor
					.selectFrom("stages")
					.select("stages.id")
					.where("stages.communityId", "=", params.communityId)
			)
	)
}

export const insertStageMembershipsOverrideRole = (
	props: NewStageMemberships & { userId: UsersId; forms: FormsId[] },
	trx = db
) =>
	autoRevalidate(
		insertStageMemberships(props, trx).qb.onConflict((oc) =>
			onConflictOverrideRole(oc, "stage", props.formId !== null)
		)
	)

export const insertPubMembershipsOverrideRole = (
	props: NewPubMemberships & { userId: UsersId; forms: FormsId[] },
	trx = db
) =>
	autoRevalidate(
		insertPubMemberships(props, trx).qb.onConflict((oc) =>
			onConflictOverrideRole(oc, "pub", props.formId !== null)
		)
	)

export const insertPubMemberships = (
	membership: NewPubMemberships & { userId: UsersId; forms: FormsId[] },
	trx = db
) => autoRevalidate(trx.insertInto("pub_memberships").values(getMembershipRows(membership)))

export const coalesceMemberships = <
	T extends {
		role: MemberRole
		formId: FormsId | null
		userId: UsersId | null
		createdAt?: Date | string
		updatedAt?: Date | string
	},
>(
	memberships: T[]
) => {
	const { formId, ...firstMembership } = memberships[0]

	return memberships.reduce(
		(acc, { updatedAt, createdAt, formId, ...membership }) => {
			let key: keyof typeof membership & string
			// check if all memberships are similar
			for (key in membership) {
				if (membership[key] !== acc[key as keyof typeof acc]) {
					throw new Error(
						`Membership ${key} mismatch between ${membership[key]} and ${acc[key as keyof typeof acc]}`
					)
				}
			}

			if (formId) {
				acc.forms.push(formId)
			}

			return acc
		},
		{
			...firstMembership,
			forms: formId ? [formId] : [],
		} as Omit<T, "formId"> & { forms: FormsId[] }
	)
}
