import type {
	CreatePubRequestBodyWithNullsNew,
	Filter,
	Json,
	JsonValue,
	MaybePubOptions,
	ProcessedPub,
	ProcessedPubWithForm,
	PubTypePubField,
	SafeUser,
} from "contracts"
import type { Database } from "db/Database"
import type {
	AutomationEvent,
	CommunitiesId,
	MembershipCapabilitiesRole,
	PubFieldsId,
	Pubs,
	PubsId,
	PubTypes,
	PubTypesId,
	PubValuesId,
	PubValues as PubValuesType,
	Stages,
	StagesId,
	UsersId,
} from "db/public"
import type { LastModifiedBy, StageConstraint } from "db/types"
import type { DefinitelyHas, MaybeHas, XOR } from "utils/types"

import {
	type AliasedSelectQueryBuilder,
	type ExpressionBuilder,
	type ExpressionWrapper,
	type Kysely,
	type ReferenceExpression,
	type SelectExpression,
	type StringReference,
	sql,
} from "kysely"
import { jsonArrayFrom, jsonObjectFrom } from "kysely/helpers/postgres"
import partition from "lodash.partition"

import {
	Capabilities,
	type CoreSchemaType,
	MemberRole,
	MembershipType,
	OperationType,
} from "db/public"
import { NO_STAGE_OPTION } from "db/types"
import { logger } from "logger"
import { assert, expect } from "utils"

import { db } from "~/kysely/database"
import { isUniqueConstraintError } from "~/kysely/errors"
import { env } from "../env/env"
import { parseRichTextForPubFieldsAndRelatedPubs } from "../fields/richText"
import { hydratePubValues, mergeSlugsWithFields } from "../fields/utils"
import { parseLastModifiedBy } from "../lastModifiedBy"
import { findRanksBetween } from "../rank"
import { autoCache } from "./cache/autoCache"
import { autoRevalidate } from "./cache/autoRevalidate"
import { BadRequestError, NotFoundError } from "./errors"
import { maybeWithTrx } from "./maybeWithTrx"
import { applyFilters } from "./pub-filters"
import { _getPubFields } from "./pubFields"
import { getPubTypeBase } from "./pubtype"
import { movePub, nestedBaseAutomationsSelect, nestedFullAutomationsSelect } from "./stages"
import { SAFE_USER_SELECT } from "./user"
import { validatePubValuesBySchemaName } from "./validateFields"

export type PubValues = Record<string, JsonValue>

// pubValuesByRef adds a JSON object of pub_values keyed by their field name under the `fields` key to the output of a query
// pubIdRef should be a column name that refers to a pubId in the current query context, such as pubs.parentId or PubsInStages.pubId
// It doesn't seem to work if you've aliased the table or column (although you can probably work around that with a cast)
export const pubValuesByRef = (pubIdRef: StringReference<Database, keyof Database>) => {
	return (eb: ExpressionBuilder<Database, keyof Database>) => pubValues(eb, { pubIdRef })
}

// pubValuesByVal does the same thing as pubDataByRef but takes an actual pubId rather than reference to a column
export const pubValuesByVal = (pubId: PubsId) => {
	return (eb: ExpressionBuilder<Database, keyof Database>) => pubValues(eb, { pubId })
}

// pubValues is the shared logic between pubValuesByRef and pubValuesByVal which handles getting the
// most recent pub field entries (since the table is append-only) and aggregating the pub_fields and
// pub_values rows into a single {"slug": "value"} JSON object
const pubValues = (
	eb: ExpressionBuilder<Database, keyof Database>,
	{
		pubId,
		pubIdRef,
	}: {
		pubId?: PubsId
		pubIdRef?: StringReference<Database, keyof Database>
	}
) => {
	const { ref } = db.dynamic

	const alias = "latest_values"
	// Although kysely has selectNoFrom, this kind of query can't be generated without using raw sql
	const jsonObjAgg = (subquery: AliasedSelectQueryBuilder<any, any>) =>
		sql<PubValues>`(select coalesce(json_object_agg(${sql.ref(alias)}.slug, ${sql.ref(
			alias
		)}.value), '{}') from ${subquery})`

	return jsonObjAgg(
		eb
			.selectFrom("pub_values")
			.selectAll("pub_values")
			.select(["slug", "pub_values.fieldId"])
			.leftJoinLateral(
				(eb) =>
					eb
						.selectFrom("pub_fields")
						.select(["id", "name", "slug", "schemaName"])
						.as("fields"),
				(join) => join.onRef("fields.id", "=", "pub_values.fieldId")
			)
			.orderBy([
				(eb) =>
					sql`${eb.fn
						.max("pub_values.updatedAt")
						.over((ob) => ob.partitionBy("pub_values.fieldId"))} desc`,
				"pub_values.rank",
			])
			.$if(!!pubId, (qb) => qb.where("pub_values.pubId", "=", pubId!))
			.$if(!!pubIdRef, (qb) => qb.whereRef("pub_values.pubId", "=", ref(pubIdRef!)))
			.as(alias)
	).as("values")
}

export const pubType = <
	DB extends Record<string, any>,
	EB extends ExpressionBuilder<DB, keyof DB>,
>({
	eb,
	pubTypeIdRef,
}: {
	eb: EB
	pubTypeIdRef: `${string}.pubTypeId` | `${string}.id`
}) =>
	jsonObjectFrom(
		getPubTypeBase(eb).whereRef(
			"pub_types.id",
			"=",
			pubTypeIdRef as ReferenceExpression<Database, "pub_types">
		)
	)
		.$notNull()
		.as("pubType")

const pubColumns = [
	"id",
	"communityId",
	"createdAt",
	"pubTypeId",
	"updatedAt",
	"title",
] as const satisfies SelectExpression<Database, "pubs">[]

export type GetManyParams = {
	limit?: number
	offset?: number
	/**
	 * @default "createdAt"
	 */
	orderBy?: "createdAt" | "updatedAt"
	/**
	 * @default "desc"
	 */
	orderDirection?: "asc" | "desc"
}

export const GET_MANY_DEFAULT = {
	limit: 10,
	offset: 0,
	orderBy: "createdAt",
	orderDirection: "desc",
} as const

const PubNotFoundError = new NotFoundError("Pub not found")

/**
 * Utility function to check if a pub exists in a community
 */
export const doPubsExist = async (
	pubIds: PubsId[],
	communitiyId: CommunitiesId,
	trx = db
): Promise<{ exists: boolean; pubs: Pubs[] }> => {
	const pubs = await autoCache(
		trx
			.selectFrom("pubs")
			.where("id", "in", pubIds)
			.where("communityId", "=", communitiyId)
			.selectAll()
	).execute()

	return {
		exists: pubIds.every((pubId) => !!pubs.find((p) => p.id === pubId)),
		pubs,
	}
}

/**
 * Utility function to check if a pub exists in a community
 */
export const doesPubExist = async (
	pubId: PubsId,
	communitiyId: CommunitiesId,
	trx = db
): Promise<{ exists: false; pub?: undefined } | { exists: true; pub: Pubs }> => {
	const { exists, pubs } = await doPubsExist([pubId], communitiyId, trx)
	return exists ? { exists: true as const, pub: pubs[0] } : { exists: false as const }
}

const isRelatedPubInit = (value: unknown): value is { value: unknown; relatedPubId: PubsId }[] =>
	Array.isArray(value) &&
	!!value.length &&
	value.every((v) => typeof v === "object" && v && "value" in v && "relatedPubId" in v)

/**
 * Transform pub values which can either be
 * {
 *   field: 'example',
 *   authors: [
 *     { value: 'admin', relatedPubId: X },
 *     { value: 'editor', relatedPubId: Y },
 *   ]
 * }
 * to a more standardized
 * [ { slug, value, relatedPubId } ]
 */
export const normalizePubValues = <T extends JsonValue | Date>(
	pubValues: Record<string, T | { value: T; relatedPubId: PubsId }[]>
) => {
	return Object.entries(pubValues).flatMap(([slug, value]) =>
		isRelatedPubInit(value)
			? value.map((v) => ({ slug, value: v.value, relatedPubId: v.relatedPubId }))
			: ([{ slug, value, relatedPubId: undefined }] as {
					slug: string
					value: T
					relatedPubId: PubsId | undefined
				}[])
	)
}

/**
 * @throws
 */
export const createPubRecursiveNew = async <Body extends CreatePubRequestBodyWithNullsNew>(
	{
		body,
		communityId,
		parent,
		lastModifiedBy,
		...options
	}:
		| {
				body: Body
				trx?: Kysely<Database>
				communityId: CommunitiesId
				parent?: never
				lastModifiedBy: LastModifiedBy
		  }
		| {
				body: MaybeHas<Body, "stageId">
				trx?: Kysely<Database>
				communityId: CommunitiesId
				parent: { id: PubsId }
				lastModifiedBy: LastModifiedBy
		  },
	depth = 0
): Promise<ProcessedPub> => {
	const trx = options?.trx ?? db

	const stageId = body.stageId

	let values = body.values ?? {}
	if (body.id) {
		const { values: processedVals } = parseRichTextForPubFieldsAndRelatedPubs({
			pubId: body.id as PubsId,
			values: values as Record<string, JsonValue>,
		})
		values = processedVals
	}
	const normalizedValues = normalizePubValues(values)

	const valuesWithFieldIds = await validatePubValues({
		pubValues: normalizedValues,
		communityId,
	})

	const result = await maybeWithTrx(trx, async (trx) => {
		const newPub = await autoRevalidate(
			trx
				.insertInto("pubs")
				.values({
					id: body.id as PubsId | undefined,
					communityId: communityId,
					pubTypeId: body.pubTypeId as PubTypesId,
				})
				.returningAll()
		).executeTakeFirstOrThrow()

		let createdStageId: StagesId | undefined
		if (stageId) {
			const result = await autoRevalidate(
				trx
					.insertInto("PubsInStages")
					.values((_eb) => ({
						pubId: newPub.id,
						stageId: expect(stageId),
					}))
					.returningAll()
			).executeTakeFirstOrThrow()

			createdStageId = result.stageId
		}

		if (body.members && Object.keys(body.members).length) {
			const _res = await trx
				.insertInto("pub_memberships")
				.values(
					Object.entries(body.members).map(([userId, role]) => ({
						pubId: newPub.id,
						userId: userId as UsersId,
						role,
					}))
				)
				// no conflict resolution is needed, as the user cannot be a member of the pub
				// since we are just now creating the pub
				.execute()
		}
		const rankedValues = await getRankedValues({
			pubId: newPub.id,
			pubValues: valuesWithFieldIds,
			trx,
		})

		const pubValues = valuesWithFieldIds.length
			? await autoRevalidate(
					trx
						.insertInto("pub_values")
						.values(
							rankedValues.map(({ fieldId, value, relatedPubId, rank }, _index) => ({
								fieldId,
								pubId: newPub.id,
								value: JSON.stringify(value),
								relatedPubId,
								rank,
								lastModifiedBy,
							}))
						)
						.returningAll()
						.$narrowType<{ value: JsonValue }>()
				).execute()
			: []

		const pub = await getPlainPub(newPub.id, trx).executeTakeFirstOrThrow()

		const hydratedValues = pubValues.map((v) => {
			const correspondingValue = valuesWithFieldIds.find(
				({ fieldId }) => fieldId === v.fieldId
			)!
			return {
				...v,
				schemaName: correspondingValue?.schemaName,
				fieldSlug: correspondingValue?.slug,
				fieldName: correspondingValue?.fieldName,
			}
		})

		if (!body.relatedPubs) {
			return {
				...pub,
				stageId: createdStageId ?? null,
				values: hydratedValues,
				depth,
			} satisfies ProcessedPub
		}

		// this fn itself calls createPubRecursiveNew, be mindful of infinite loops
		const relatedPubs = await upsertPubRelations(
			{
				pubId: newPub.id,
				relations: Object.entries(body.relatedPubs).flatMap(
					([fieldSlug, relatedPubBodies]) =>
						relatedPubBodies.map(({ pub, value }) => ({
							slug: fieldSlug,
							value,
							relatedPub: pub,
						}))
				),
				communityId,
				lastModifiedBy,
				trx,
			},
			depth
		)

		return {
			...pub,
			stageId: createdStageId,
			values: [...pubValues, ...relatedPubs],
			depth,
		} as ProcessedPub
	})

	return result
}

export const deletePubValuesByValueId = async ({
	pubId,
	valueIds,
	lastModifiedBy,
	trx = db,
}: {
	pubId: PubsId
	valueIds: PubValuesId[]
	lastModifiedBy: LastModifiedBy
	trx?: typeof db
}) => {
	if (valueIds.length === 0) {
		return
	}

	const result = await maybeWithTrx(trx, async (trx) => {
		const deletedPubValues = await autoRevalidate(
			trx
				.deleteFrom("pub_values")
				.where("id", "in", valueIds)
				.where("pubId", "=", pubId)
				.returningAll()
		).execute()

		await addDeletePubValueHistoryEntries({
			lastModifiedBy,
			pubValues: deletedPubValues,
			trx,
		})

		return deletedPubValues
	})

	return result
}

export const deletePub = async ({
	pubId,
	lastModifiedBy,
	communityId,
	trx = db,
}: {
	pubId: PubsId | PubsId[]
	lastModifiedBy: LastModifiedBy
	communityId: CommunitiesId
	trx?: typeof db
}) => {
	const result = await maybeWithTrx(trx, async (trx) => {
		// first get the values before they are deleted
		// that way we can add them to the history table
		const pubValues = await trx
			.selectFrom("pub_values")
			.where("pubId", "in", Array.isArray(pubId) ? pubId : [pubId])
			.selectAll()
			.execute()

		const deleteResult = await autoRevalidate(
			trx
				.deleteFrom("pubs")
				.where("id", "in", Array.isArray(pubId) ? pubId : [pubId])
				.where("communityId", "=", communityId)
		).executeTakeFirstOrThrow()

		// this might not be necessary if we rarely delete pubs and
		// give users ample warning that deletion is irreversible
		// in that case we should probably also delete the relevant rows in the pub_values_history table
		await addDeletePubValueHistoryEntries({
			lastModifiedBy,
			pubValues,
			trx,
		})

		return deleteResult
	})

	return result
}

export const getPubStage = (pubId: PubsId, trx = db) =>
	autoCache(trx.selectFrom("PubsInStages").select("stageId").where("pubId", "=", pubId))

export const getPlainPub = (pubId: PubsId, trx = db) =>
	autoCache(trx.selectFrom("pubs").selectAll().where("id", "=", pubId))
/**
 * Consolidates field slugs with their corresponding field IDs and schema names from the community.
 * Validates that all provided slugs exist in the community.
 * @throws Error if any slugs don't exist in the community
 */
export const getFieldInfoForSlugs = async (
	{
		slugs,
		communityId,
	}: {
		slugs: string[]
		communityId: CommunitiesId
	},
	trx = db
) => {
	const toBeUpdatedPubFieldSlugs = Array.from(new Set(slugs))

	if (toBeUpdatedPubFieldSlugs.length === 0) {
		return []
	}

	const { fields } = await _getPubFields(
		{
			communityId,
			slugs: toBeUpdatedPubFieldSlugs,
		},
		trx
	).executeTakeFirstOrThrow()

	const pubFields = Object.values(fields)

	const slugsThatDontExistInCommunity = toBeUpdatedPubFieldSlugs.filter(
		(slug) => !pubFields.find((field) => field.slug === slug)
	)

	if (slugsThatDontExistInCommunity.length) {
		throw new Error(
			`Pub values contain fields that do not exist in the community: ${slugsThatDontExistInCommunity.join(", ")}`
		)
	}

	const fieldsWithSchemaName = pubFields.filter((field) => field.schemaName !== null)

	if (fieldsWithSchemaName.length !== pubFields.length) {
		throw new Error(
			`Pub values contain fields that do not have a schema name: ${pubFields
				.filter((field) => field.schemaName === null)
				.map(({ slug }) => slug)
				.join(", ")}`
		)
	}

	return pubFields.map((field) => ({
		slug: field.slug,
		fieldId: field.id,
		schemaName: expect(field.schemaName),
		fieldName: field.name,
	}))
}

export const validatePubValues = async <T extends { slug: string; value: unknown }>({
	pubValues,
	communityId,
	continueOnValidationError = false,
	trx = db,
}: {
	pubValues: T[]
	communityId: CommunitiesId
	continueOnValidationError?: boolean
	trx?: typeof db
}) => {
	const relevantPubFields = await getFieldInfoForSlugs(
		{
			slugs: pubValues.map(({ slug }) => slug),
			communityId,
		},
		trx
	)

	const mergedPubFields = mergeSlugsWithFields(pubValues, relevantPubFields)

	const hydratedPubValues = hydratePubValues(mergedPubFields)

	const { errors, results: newResults } = validatePubValuesBySchemaName(hydratedPubValues)

	if (!errors.length) {
		return newResults
	}

	if (continueOnValidationError) {
		return hydratedPubValues.filter(
			({ slug }) => !errors.find(({ slug: errorSlug }) => errorSlug === slug)
		)
	}

	throw new BadRequestError(errors.map(({ error }) => error).join(" "))
}

type AddPubRelationsInput = { value: JsonValue | Date; slug: string } & XOR<
	{ relatedPubId: PubsId },
	{ relatedPub: CreatePubRequestBodyWithNullsNew }
>
type UpdatePubRelationsInput = { value: JsonValue | Date; slug: string; relatedPubId: PubsId }

type RemovePubRelationsInput = { value?: never; slug: string; relatedPubId: PubsId }

export const normalizeRelationValues = (
	relations: AddPubRelationsInput[] | UpdatePubRelationsInput[]
) => {
	return relations
		.filter((relation) => relation.value !== undefined)
		.map((relation) => ({ slug: relation.slug, value: relation.value }))
}

/**
 * Upserts pub relations by either creating new related pubs or linking to existing ones.
 *
 * This function handles two cases:
 * 1. Creating brand new pubs and linking them as relations (via relatedPub)
 * 2. Linking to existing pubs (via relatedPubId)
 *
 * Note: it is the responsibility of the caller to ensure that the pub exists
 *
 */
export const upsertPubRelations = async (
	{
		pubId,
		relations,
		communityId,
		lastModifiedBy,
		trx = db,
	}: {
		pubId: PubsId
		relations: AddPubRelationsInput[]
		communityId: CommunitiesId
		lastModifiedBy: LastModifiedBy
		trx?: typeof db
	},
	depth = 0
): Promise<ProcessedPub["values"]> => {
	const normalizedRelationValues = normalizeRelationValues(relations)

	const validatedRelationValues = await validatePubValues({
		pubValues: normalizedRelationValues,
		communityId,
		continueOnValidationError: false,
	})

	const { newPubs, existingPubs } = relations.reduce(
		(acc, rel) => {
			const fieldId = validatedRelationValues.find(({ slug }) => slug === rel.slug)?.fieldId
			assert(fieldId, `No pub field found for slug '${rel.slug}'`)

			if (rel.relatedPub) {
				acc.newPubs.push({ ...rel, fieldId })
			} else {
				acc.existingPubs.push({ ...rel, fieldId })
			}

			return acc
		},
		{
			newPubs: [] as (AddPubRelationsInput & {
				relatedPubId?: never
				fieldId: PubFieldsId
			})[],
			existingPubs: [] as (AddPubRelationsInput & {
				relatedPub?: never
				fieldId: PubFieldsId
			})[],
		}
	)

	const pubRelations = await maybeWithTrx(trx, async (trx) => {
		const newlyCreatedPubs = await Promise.all(
			newPubs.map((pub) =>
				createPubRecursiveNew(
					{
						trx,
						communityId,
						body: pub.relatedPub,
						lastModifiedBy: lastModifiedBy,
					},
					depth + 1
				)
			)
		)

		// assumed they keep their order

		const newPubsWithRelatedPubId = newPubs.map((pub, index) => ({
			...pub,
			relatedPubId: expect(newlyCreatedPubs[index].id),
		}))

		const allRelationsToCreate = [...newPubsWithRelatedPubId, ...existingPubs]

		const pubRelations = await upsertPubRelationValues({
			pubId,
			allRelationsToCreate,
			lastModifiedBy,
			trx,
		})

		const createdRelations = pubRelations.map((relation) => {
			const correspondingValue = validatedRelationValues.find(
				({ fieldId }) => fieldId === relation.fieldId
			)!

			return {
				...relation,
				schemaName: correspondingValue.schemaName,
				fieldSlug: correspondingValue.slug,
				relatedPub: newlyCreatedPubs.find(({ id }) => id === relation.relatedPubId),
				fieldName: correspondingValue.fieldName,
			}
		})

		return createdRelations
	})

	return pubRelations
}

/**
 * Removes specific pub relations by deleting pub_values entries that match the provided relations.
 * Each relation must specify a field slug and relatedPubId to identify which relation to remove.
 *
 * Note: it is the responsibility of the caller to ensure that the pub exists
 */
export const removePubRelations = async ({
	pubId,
	relations,
	communityId,
	lastModifiedBy,
	trx = db,
}: {
	pubId: PubsId
	relations: RemovePubRelationsInput[]
	communityId: CommunitiesId
	lastModifiedBy: LastModifiedBy
	trx?: typeof db
}) => {
	const consolidatedRelations = await getFieldInfoForSlugs(
		{
			slugs: relations.map(({ slug }) => slug),
			communityId,
		},
		trx
	)

	const mergedRelations = mergeSlugsWithFields(relations, consolidatedRelations)

	const removed = await autoRevalidate(
		trx
			.deleteFrom("pub_values")
			.where("pubId", "=", pubId)
			.where((eb) =>
				eb.or(
					mergedRelations.map(({ fieldId, relatedPubId }) =>
						eb.and([eb("fieldId", "=", fieldId), eb("relatedPubId", "=", relatedPubId)])
					)
				)
			)
			.returningAll()
	).execute()

	await addDeletePubValueHistoryEntries({
		lastModifiedBy,
		pubValues: removed,
		trx,
	})

	return removed.map(({ relatedPubId }) => relatedPubId)
}

/**
 * Removes all relations for a given field slug and pubId
 *
 * Note: it is the responsibility of the caller to ensure that the pub exists
 */
export const removeAllPubRelationsBySlugs = async ({
	pubId,
	slugs,
	communityId,
	lastModifiedBy,
	trx = db,
}: {
	pubId: PubsId
	slugs: string[]
	communityId: CommunitiesId
	lastModifiedBy: LastModifiedBy
	trx?: typeof db
}) => {
	if (slugs.length === 0) {
		return []
	}

	const fields = await getFieldInfoForSlugs(
		{
			slugs: slugs,
			communityId,
		},
		trx
	)
	const fieldIds = fields.map(({ fieldId }) => fieldId)
	if (!fieldIds.length) {
		throw new Error(`No fields found for slugs: ${slugs.join(", ")}`)
	}

	const removed = await autoRevalidate(
		trx
			.deleteFrom("pub_values")
			.where("pubId", "=", pubId)
			.where("fieldId", "in", fieldIds)
			.where("relatedPubId", "is not", null)
			.returningAll()
	).execute()

	await addDeletePubValueHistoryEntries({
		lastModifiedBy,
		pubValues: removed,
		trx,
	})

	return removed.map(({ relatedPubId }) => relatedPubId)
}

export const addDeletePubValueHistoryEntries = async ({
	lastModifiedBy,
	pubValues,
	trx = db,
}: {
	lastModifiedBy: LastModifiedBy
	pubValues: PubValuesType[]
	trx?: typeof db
}) => {
	const parsedLastModifiedBy = parseLastModifiedBy(lastModifiedBy)

	if (!pubValues.length) {
		return
	}

	await autoRevalidate(
		trx.insertInto("pub_values_history").values(
			pubValues.map((pubValue) => ({
				operationType: OperationType.delete,
				oldRowData: JSON.stringify(pubValue),
				pubValueId: pubValue.id,
				...parsedLastModifiedBy,
			}))
		)
	).execute()
}

/**
 * Replaces all relations for given field slugs with new relations.
 * First removes all existing relations for the provided slugs, then adds the new relations.
 *
 * If the `relations` object is empty, this function does nothing.
 */
export const replacePubRelationsBySlug = async ({
	pubId,
	relations,
	communityId,
	lastModifiedBy,
	trx = db,
}: {
	pubId: PubsId
	relations: AddPubRelationsInput[]
	communityId: CommunitiesId
	lastModifiedBy: LastModifiedBy
	trx?: typeof db
}) => {
	if (!Object.keys(relations).length) {
		return
	}

	await maybeWithTrx(trx, async (trx) => {
		const slugs = relations.map(({ slug }) => slug)

		await removeAllPubRelationsBySlugs({ pubId, slugs, communityId, lastModifiedBy, trx })

		await upsertPubRelations({ pubId, relations, communityId, lastModifiedBy, trx })
	})
}

export const updatePub = async ({
	pubId,
	pubValues,
	communityId,
	stageId,
	continueOnValidationError,
	lastModifiedBy,
}: {
	pubId: PubsId
	pubValues: Record<string, Json | { value: Json; relatedPubId: PubsId }[]>
	communityId: CommunitiesId
	lastModifiedBy: LastModifiedBy
	stageId?: StagesId
	continueOnValidationError: boolean
}) => {
	const result = await maybeWithTrx(db, async (trx) => {
		// Update the stage if a target stage was provided.
		if (stageId !== undefined) {
			try {
				await movePub(pubId, stageId, trx).execute()
			} catch (err) {
				if (!isUniqueConstraintError(err)) {
					throw err
				}
			}
		}

		// Allow rich text fields to overwrite other fields
		const { values: processedVals } = parseRichTextForPubFieldsAndRelatedPubs({
			pubId,
			values: pubValues,
		})

		const normalizedValues = normalizePubValues(processedVals)

		const pubValuesWithSchemaNameAndFieldId = await validatePubValues({
			pubValues: normalizedValues,
			communityId,
			continueOnValidationError,
			trx,
		})

		if (!pubValuesWithSchemaNameAndFieldId.length) {
			return {
				success: true,
				report: "Pub not updated, no pub values to update",
			}
		}

		// Separate into fields with relationships and those without
		const [pubValuesWithRelations, pubValuesWithoutRelations] = partition(
			pubValuesWithSchemaNameAndFieldId,
			(pv) => pv.relatedPubId
		)

		if (pubValuesWithRelations.length) {
			await replacePubRelationsBySlug({
				pubId,
				relations: pubValuesWithRelations.map(
					(pv) =>
						({
							value: pv.value,
							slug: pv.slug,
							relatedPubId: pv.relatedPubId,
						}) as AddPubRelationsInput
				),
				communityId,
				lastModifiedBy,
				trx,
			})
		}

		if (pubValuesWithoutRelations.length) {
			const result = await upsertPubValues({
				pubId,
				pubValues: pubValuesWithoutRelations,
				lastModifiedBy,
				trx,
			})

			return result
		}
	})

	return result
}

/**
 * Adds an appropriate "rank" attribute to each related pub value passed in, based on the highest
 * existing rank on the relevant pub. Returns all the pub values passed in.
 */

const getRankedValues = async ({
	pubId,
	pubValues,
	trx,
}: {
	pubId: PubsId
	pubValues: {
		pubId?: PubsId
		fieldId: PubFieldsId
		relatedPubId?: PubsId
		value: unknown
	}[]
	trx: typeof db
}) => {
	const { relatedValues, plainValues } = Object.groupBy(pubValues, (v) =>
		v.relatedPubId === undefined ? "plainValues" : "relatedValues"
	)
	const groupedValues: Record<
		PubsId,
		Record<PubFieldsId, DefinitelyHas<(typeof pubValues)[number], "pubId">[]>
	> = {}
	let rankedValues: ((typeof pubValues)[number] & { rank?: string })[] = []
	if (relatedValues?.length) {
		const firstVal = relatedValues[0]

		const valuesQuery = trx
			.selectFrom("pub_values")
			.select(["rank", "fieldId", "pubId"])
			.where("pubId", "=", firstVal.pubId ?? pubId)
			.where("fieldId", "=", firstVal.fieldId)
			.where("rank", "is not", null)
			.orderBy("rank desc")
			.limit(1)

		for (const value of relatedValues) {
			const newValue = { ...value, pubId: value.pubId ?? pubId }
			if (!groupedValues[newValue.pubId]) {
				groupedValues[newValue.pubId] = { [value.fieldId]: [newValue] }
			} else if (!groupedValues[newValue.pubId][value.fieldId]) {
				groupedValues[newValue.pubId][value.fieldId] = [newValue]
			}

			// If we've already found the highest ranked value for this pubId + fieldId combination,
			// continue without adding to the query
			else if (
				groupedValues[newValue.pubId] &&
				groupedValues[newValue.pubId][value.fieldId]?.length
			) {
				groupedValues[newValue.pubId][value.fieldId].push(newValue)
				continue
			}

			if (value === firstVal) {
				continue
			}

			// Select the highest ranked value for the given pub + field, and append (UNION ALL)
			// that single row to the output
			valuesQuery.unionAll((eb) =>
				eb
					.selectFrom("pub_values")
					.select(["rank", "fieldId", "pubId"])
					.where("pubId", "=", newValue.pubId)
					.where("fieldId", "=", value.fieldId)
					.where("rank", "is not", null)
					.orderBy("rank")
					.limit(1)
			)
		}
		const highestRanks = await valuesQuery.execute()

		rankedValues = Object.values(groupedValues).flatMap((valuesForPub) =>
			Object.values(valuesForPub).flatMap((valuesForField) => {
				const highestRank =
					highestRanks.find(
						({ pubId, fieldId }) =>
							valuesForField[0].pubId === pubId &&
							valuesForField[0].fieldId === fieldId
					)?.rank ?? ""
				const ranks = findRanksBetween({
					start: highestRank,
					numberOfRanks: valuesForField.length,
				})
				return valuesForField.map((value, i) => ({ ...value, rank: ranks[i] }))
			})
		)
	}

	const allValues: ((typeof pubValues)[number] & { rank?: string })[] = [
		...(plainValues || []),
		...(rankedValues || []),
	]

	return allValues
}

export const upsertPubValues = async ({
	pubId,
	pubValues,
	lastModifiedBy,
	trx,
}: {
	pubId: PubsId
	pubValues: {
		/**
		 * specify this if you do not want to use the pubId provided in the input
		 */
		pubId?: PubsId
		fieldId: PubFieldsId
		relatedPubId?: PubsId
		value: unknown
	}[]
	lastModifiedBy: LastModifiedBy
	trx: typeof db
}): Promise<PubValuesType[]> => {
	if (!pubValues.length) {
		return []
	}
	const rankedValues = await getRankedValues({ pubId, pubValues, trx })

	return autoRevalidate(
		trx
			.insertInto("pub_values")
			.values(
				rankedValues.map((value) => ({
					pubId: value.pubId ?? pubId,
					fieldId: value.fieldId,
					value: JSON.stringify(value.value),
					lastModifiedBy,
					relatedPubId: value.relatedPubId,
					rank: value.rank,
				}))
			)
			.onConflict((oc) =>
				oc
					// we have a unique index on pubId and fieldId where relatedPubId is null
					.columns(["pubId", "fieldId"])
					.where("relatedPubId", "is", null)
					.doUpdateSet((eb) => ({
						value: eb.ref("excluded.value"),
						lastModifiedBy: eb.ref("excluded.lastModifiedBy"),
					}))
			)
			.returningAll()
	).execute()
}

export const upsertPubRelationValues = async ({
	pubId,
	allRelationsToCreate,
	lastModifiedBy,
	trx,
}: {
	pubId: PubsId
	allRelationsToCreate: {
		pubId?: PubsId
		relatedPubId: PubsId
		value: JsonValue | Date
		fieldId: PubFieldsId
	}[]
	lastModifiedBy: LastModifiedBy
	trx: typeof db
}) => {
	if (!allRelationsToCreate.length) {
		return []
	}

	const rankedValues = await getRankedValues({ pubId, pubValues: allRelationsToCreate, trx })

	return autoRevalidate(
		trx
			.insertInto("pub_values")
			.values(
				rankedValues.map((value) => ({
					pubId: value.pubId ?? pubId,
					relatedPubId: value.relatedPubId,
					value: JSON.stringify(value.value),
					fieldId: value.fieldId,
					rank: value.rank,
					lastModifiedBy,
				}))
			)
			.onConflict((oc) =>
				oc
					.columns(["pubId", "fieldId", "relatedPubId"])
					.where("relatedPubId", "is not", null)
					// upsert
					.doUpdateSet((eb) => ({
						value: eb.ref("excluded.value"),
						lastModifiedBy: eb.ref("excluded.lastModifiedBy"),
						rank: eb.ref("excluded.rank"),
					}))
			)
			.returningAll()
			.$narrowType<{ value: JsonValue }>()
	).execute()
}

export type UnprocessedPub = {
	id: PubsId
	depth: number
	stageId: StagesId | null
	stage?: Stages
	communityId: CommunitiesId
	pubTypeId: PubTypesId
	pubType?: PubTypes & { fields: PubTypePubField[] }
	members?: SafeUser & { role: MemberRole }
	createdAt: Date
	updatedAt: Date
	isCycle?: boolean
	title: string | null
	path: PubsId[]
	values: {
		id: PubValuesId
		fieldId: PubFieldsId
		value: unknown
		relatedPubId: PubsId | null
		createdAt: Date
		updatedAt: Date
		schemaName: CoreSchemaType
		fieldSlug: string
		fieldName: string
	}[]
}

export interface GetPubsWithRelatedValuesOptions
	extends Omit<GetManyParams, "orderBy">,
		MaybePubOptions {
	orderBy?: "createdAt" | "updatedAt" | "title"
	/**
	 * The maximum depth to recurse to.
	 * Does not do anything if `includeRelatedPubs` is `false`, or if `count` is true.
	 *
	 * @default 2
	 */
	depth?: number
	searchConfig?: SearchConfig

	withStageAutomations?:
		| {
				detail: "count" | "full" | "base"
				filter: AutomationEvent[] | "all"
		  }
		| false
	/**
	 * Whether to include the first pub that is part of a cycle.
	 * By default, the first "cycled" pub is included, marked with `isCycle: true`.
	 *
	 * This is useful if you want to show to users that a cycle has happened,
	 * otherwise you might want to exclude it.
	 *
	 * @default "include"
	 */
	cycle?: "include" | "exclude"
	/**
	 * Only used for testing.
	 * If true the raw result of the query is returned, without nesting the values.
	 */
	_debugDontNest?: boolean
	fieldSlugs?: string[]
	onlyTitles?: boolean
	trx?: typeof db
	filters?: Filter
	/**
	 * A custom filter function that receives the expression builder and returns a filter condition.
	 * Useful for applying JSONata-based filters or other complex conditions.
	 */
	customFilter?: (eb: ExpressionBuilder<Database, "pubs">) => ExpressionWrapper<any, any, any>
	/**
	 * Constraints on which pub types the user/token has access to. Will also filter related pubs.
	 */
	allowedPubTypes?: PubTypesId[]
	/**
	 * Constraints on which stages the user/token has access to. Will also filter related pubs.
	 */
	allowedStages?: StageConstraint[]
	/**
	 * If true, only the count of pubs will be returned, without any other information.
	 */
	count?: boolean
}

// TODO: We allow calling getPubsWithRelatedValues with no userId so that event driven
// actions can select a pub even when no user is present (and some other scenarios where the
// filtering wouldn't make sense). We probably need to do that, but we should make it more explicit
// than just leaving out the userId to avoid accidentally letting certain routes select pubs without
// authorization checks
type PubIdOrPubTypeIdOrStageIdOrCommunityId =
	| {
			pubId: PubsId
			pubIds?: never
			pubTypeId?: never
			stageId?: never
			communityId: CommunitiesId
			userId?: UsersId
	  }
	| {
			pubId?: never
			/**
			 * Multiple pubIds to filter by
			 */
			pubIds?: PubsId[]
			/**
			 * Requested pub types. Allowed pubtypes the user/token has access to should be put in options
			 */
			pubTypeId?: PubTypesId[]
			/**
			 * Requested stages. Allowed stages the user/token has access to should be put in options
			 */
			stageId?: StageConstraint[]
			communityId: CommunitiesId
			userId?: UsersId
	  }

const DEFAULT_OPTIONS = {
	depth: 2,
	withRelatedPubs: true,
	withPubType: false,
	withStage: false,
	withMembers: false,
	cycle: "include",
	withValues: true,
	withRelatedCounts: false,
	withStageAutomations: false,
	trx: db,
} as const satisfies GetPubsWithRelatedValuesOptions

const COUNT_OPTIONS = {
	...DEFAULT_OPTIONS,
	withRelatedPubs: false,
	withValues: false,
	depth: 1,
	withRelatedCounts: false,
	count: true,
	withPubType: false,
	withSearchValues: false,
	withStageAutomations: false,
	withMembers: false,
	withStage: false,
	trx: db,
} as const satisfies GetPubsWithRelatedValuesOptions

export async function getPubsWithRelatedValues<Options extends GetPubsWithRelatedValuesOptions>(
	props: Extract<PubIdOrPubTypeIdOrStageIdOrCommunityId, { pubId: PubsId }>,
	options?: Options
	// if only pubId + communityId is provided, we return a single pub
): Promise<ProcessedPub<Options>>
export async function getPubsWithRelatedValues<Options extends GetPubsWithRelatedValuesOptions>(
	props: Exclude<PubIdOrPubTypeIdOrStageIdOrCommunityId, { pubId: PubsId }>,
	options?: Options
	// if any other props are provided, we return an array of pubs
): Promise<ProcessedPub<Options>[]>
/**
 * Retrieves a pub and all its values and related pubs up to a given depth.
 */
export async function getPubsWithRelatedValues<Options extends GetPubsWithRelatedValuesOptions>(
	props: PubIdOrPubTypeIdOrStageIdOrCommunityId,
	options?: Options
): Promise<ProcessedPub<Options> | ProcessedPub<Options>[]> {
	const opts = {
		...(options?.count ? COUNT_OPTIONS : DEFAULT_OPTIONS),
		...options,
	}

	const {
		depth,
		withRelatedPubs,
		withValues,
		cycle,
		fieldSlugs,
		orderBy,
		orderDirection,
		limit,
		offset,
		search,
		withSearchValues,
		searchConfig,
		withPubType,
		withStage,
		withStageAutomations,
		withMembers,
		trx,
		allowedPubTypes,
		allowedStages,
		withRelatedCounts,
		withIncomingRelations: _withIncomingRelations,
		count,
	} = opts

	if (depth < 1) {
		throw new Error("Depth must be a positive number")
	}

	const _topLevelPubTypeFilter = Array.from(
		new Set([...(props.pubTypeId ?? []), ...(allowedPubTypes ?? [])])
	)

	const _topLevelStageFilter = Array.from(
		new Set([...(props.stageId ?? []), ...(allowedStages ?? [])])
	)

	const language = searchConfig?.language ?? DEFAULT_FULLTEXT_SEARCH_OPTS.language
	const headlineConfig =
		searchConfig?.headlineConfig ?? DEFAULT_FULLTEXT_SEARCH_OPTS.headlineConfig
	const tsQuery = search ? createTsQuery(search, searchConfig) : undefined

	const includeSearchValues = Boolean(search) && withSearchValues !== false

	const result = await autoCache(
		trx
			// this pub_tree CTE roughly returns an array like so
			// [
			// 	{ pubId: 1, rootId: 1, parentId: null, depth: 1, value: 'Some value', valueId: 1, relatedPubId: null},
			//  { pubId: 1, rootId: 1, parentId: 1, depth: 1, value: 'Some relationship value', valueId: 2, relatedPubId: 3},
			//  { pubId: 2, rootId: 1, parentId: 1, depth: 2, value: 'Some child value', valueId: 3, relatedPubId: null},
			//  { pubId: 3, rootId: 1, parentId: 2, depth: 2, value: 'Some related value', valueId: 4, relatedPubId: null},
			// ]
			// so it's an array of length (pub + relatedPubs) * values,
			// with information about their depth, parent, and pub they are related to
			//
			// we could instead only look for the related and child pubs and ignore the other values
			// but this would mean we would later need to look up the values for each pub as a subquery
			// this way, the only subqueries we need below are looking up information already stored in pub_tree,
			// which is more efficient
			.withRecursive("pub_tree", (cte) =>
				cte
					// we need to do this weird cast, because kysely does not support typing the selecting from a later CTE
					// which is possible only in a with recursive query
					.selectFrom("root_pubs_limited as p" as unknown as "pubs as p")
					// TODO: can we avoid doing this join again since it's already in root pubs?
					.leftJoin("PubsInStages", "p.id", "PubsInStages.pubId")
					.$if(Boolean(withRelatedPubs), (qb) =>
						qb
							.leftJoin("pub_values as pv", (join) =>
								join.on((eb) =>
									eb.and([
										eb("pv.pubId", "=", eb.ref("p.id")),
										eb("pv.relatedPubId", "is not", null),
									])
								)
							)
							.select("pv.relatedPubId")
					)
					.select([
						"p.id as pubId",
						"p.pubTypeId",
						"p.communityId",
						"p.createdAt",
						"p.updatedAt",
						"p.title",
						"PubsInStages.stageId",
						sql<number>`1`.as("depth"),
						sql<boolean>`false`.as("isCycle"),
						sql<PubsId[]>`array[p.id]`.as("path"),
					])

					// we don't even need to recurse if we don't want related pubs
					.$if(withRelatedPubs, (qb) =>
						qb.union((qb) =>
							qb
								.selectFrom("pub_tree")
								.innerJoin("pubs", (join) =>
									join.on((eb) =>
										eb.or(
											withRelatedPubs
												? [
														eb(
															"pubs.id",
															"=",
															eb.ref("pub_tree.relatedPubId")
														),
													]
												: []
										)
									)
								)
								.leftJoin("PubsInStages", "pubs.id", "PubsInStages.pubId")
								.$if(Boolean(allowedStages?.length), (qb) =>
									qb.where((eb) =>
										stagesWhere(eb, allowedStages!, "PubsInStages.stageId")
									)
								)
								.where((eb) =>
									eb.exists(
										eb.selectFrom("capabilities" as any).where((ebb) => {
											type Inner = typeof ebb extends ExpressionBuilder<
												infer Thing,
												any
											>
												? Thing
												: never
											const eb = ebb as ExpressionBuilder<
												Inner & {
													capabilities: {
														membId: string
														type: MembershipType
														role: MembershipCapabilitiesRole
													}
												},
												any
											>

											return eb.or([
												eb.and([
													eb(
														"capabilities.type",
														"=",
														MembershipType.stage
													),
													eb(
														"capabilities.membId",
														"=",
														eb.ref("PubsInStages.stageId")
													),
												]),
												eb.and([
													eb(
														"capabilities.type",
														"=",
														MembershipType.pub
													),
													eb(
														"capabilities.membId",
														"=",
														eb.ref("pubs.id")
													),
												]),
												eb.and([
													eb(
														"capabilities.type",
														"=",
														MembershipType.community
													),
													eb(
														"capabilities.membId",
														"=",
														props.communityId
													),
												]),
											])
										})
									)
								)
								.$if(Boolean(withRelatedPubs), (qb) =>
									qb
										.leftJoin("pub_values", (join) =>
											join.on((eb) =>
												eb.and([
													eb("pub_values.pubId", "=", eb.ref("pubs.id")),
													eb("pub_values.relatedPubId", "is not", null),
												])
											)
										)
										.select("pub_values.relatedPubId")
								)
								// filter out pubtypes the user does not have access to
								// we don't filter by props.pubTypeId here, as when a user looks up say all Submissions and their related values,
								// we want to show all related values regardless of the pub type of the related pub
								// TODO: maybe add an option to filter related pubs by pub type?
								.$if(Boolean(allowedPubTypes), (qb) =>
									qb.where("pubs.pubTypeId", "in", allowedPubTypes!)
								)
								.select([
									"pubs.id as pubId",
									"pubs.pubTypeId",
									"pubs.communityId",
									"pubs.createdAt",
									"pubs.updatedAt",
									"pubs.title",
									"PubsInStages.stageId",
									// increment the depth
									sql<number>`pub_tree.depth + 1`.as("depth"),
									// this is a standard way to detect cycles
									// we keep track of the path we've taken so far,
									// and set a flag if we see a pub that is already in the path
									// https://www.postgresql.org/docs/current/queries-with.html#QUERIES-WITH-CYCLE
									sql<boolean>`pubs.id = any(pub_tree."path")`.as("isCycle"),
									sql<PubsId[]>`array_append(pub_tree."path", pubs.id)`.as(
										"path"
									),
								])
								.where("pub_tree.depth", "<", depth)
								.where("pub_tree.isCycle", "=", false)
								.$if(cycle === "exclude", (qb) =>
									// this makes sure we don't include the first pub that is part of a cycle
									qb.where(sql<boolean>`pubs.id = any(pub_tree.path)`, "=", false)
								)
						)
					)
			)
			.with("stage_ms", (db) =>
				db
					.selectFrom("stage_memberships")
					.$if(Boolean(props.userId), (qb) =>
						qb
							.where("stage_memberships.userId", "=", props.userId!)
							.select([
								"role",
								"stageId as membId",
								sql<MembershipType>`'stage'::"MembershipType"`.as("type"),
							])
					)
					.$castTo<{
						role: MembershipCapabilitiesRole
						membId: string
						type: MembershipType
					}>()
			)
			.with("pub_ms", (db) =>
				db
					.selectFrom("pub_memberships")
					.$if(Boolean(props.userId), (qb) =>
						qb
							.where("pub_memberships.userId", "=", props.userId!)
							.select([
								"role",
								"pubId as membId",
								sql<MembershipType>`'pub'::"MembershipType"`.as("type"),
							])
					)
					.$castTo<{
						role: MembershipCapabilitiesRole
						membId: string
						type: MembershipType
					}>()
			)
			.with("community_ms", (db) =>
				db
					.selectFrom("community_memberships")
					.$if(Boolean(props.userId), (qb) =>
						qb
							.where("community_memberships.userId", "=", props.userId!)
							.where("community_memberships.communityId", "=", props.communityId)
							.select([
								"role",
								"communityId as membId",
								sql<MembershipType>`'community'::"MembershipType"`.as("type"),
							])
					)
					// Add a fake community admin role when selecting without a userId
					.$if(!props.userId, (qb) =>
						qb.select((eb) => [
							sql<MemberRole>`${MemberRole.admin}::"MemberRole"`.as("role"),
							eb.val(props.communityId).as("membId"),
							sql<MembershipType>`'community'::"MembershipType"`.as("type"),
						])
					)

					.$castTo<{
						role: MembershipCapabilitiesRole
						membId: string
						type: MembershipType
					}>()
			)
			.with("memberships", (cte) =>
				cte
					.selectFrom("community_ms")
					.selectAll("community_ms")
					.$if(Boolean(props.userId), (qb) =>
						qb
							.union((qb) => qb.selectFrom("pub_ms").selectAll("pub_ms"))
							.union((qb) => qb.selectFrom("stage_ms").selectAll("stage_ms"))
							// Add fake community admin role when user is a superadmin
							.union((qb) =>
								qb
									.selectFrom("users")
									.where("users.id", "=", props.userId!)
									.where("users.isSuperAdmin", "=", true)
									.select((eb) => [
										sql<MemberRole>`${MemberRole.admin}::"MemberRole"`.as(
											"role"
										),
										eb.val(props.communityId).as("membId"),
										sql<MembershipType>`'community'::"MembershipType"`.as(
											"type"
										),
									])
							)
					)
			)
			.with("capabilities", (cte) =>
				cte
					.selectFrom("memberships")
					.innerJoin("membership_capabilities", (join) =>
						join.on((eb) =>
							eb.and([
								eb("membership_capabilities.role", "=", eb.ref("memberships.role")),
								eb("membership_capabilities.type", "=", eb.ref("memberships.type")),
							])
						)
					)
					.where("membership_capabilities.capability", "in", [
						Capabilities.viewPub,
						Capabilities.viewStage,
					])
					.selectAll("memberships")
			)
			// this CTE finds the top level pubs and limits the result
			// counter intuitively, this is CTE is referenced in the above `withRecursive` call, despite
			// appearing after it. This is allowed in Postgres. See https://www.postgresql.org/docs/current/sql-select.html#SQL-WITH
			// this is mostly because `kysely` does not allow you to put a normal CTE before a recursive CTE
			.with("root_pubs_limited", (cte) =>
				cte
					.selectFrom("pubs")
					.selectAll("pubs")
					.where("pubs.communityId", "=", props.communityId)
					.leftJoin("PubsInStages", "pubs.id", "PubsInStages.pubId")
					.select("PubsInStages.stageId")
					.where((eb) =>
						eb.exists(
							eb
								.selectFrom("capabilities")
								.where((eb) =>
									eb.or([
										eb.and([
											eb("capabilities.type", "=", MembershipType.stage),
											eb(
												"capabilities.membId",
												"=",
												eb.ref("PubsInStages.stageId")
											),
										]),
										eb.and([
											eb("capabilities.type", "=", MembershipType.pub),
											eb("capabilities.membId", "=", eb.ref("pubs.id")),
										]),
										eb.and([
											eb("capabilities.type", "=", MembershipType.community),
											eb("capabilities.membId", "=", props.communityId),
										]),
									])
								)
						)
					)
					.$if(!!props.pubId, (qb) => qb.where("pubs.id", "=", props.pubId!))
					.$if(!!props.pubIds && props.pubIds.length > 0, (qb) =>
						qb.where("pubs.id", "in", props.pubIds!)
					)
					// stage filter
					// we need to do these checks separately bc just bc you are only allowed to see
					// some stages, doesn't mean you _want_ to see all stages
					// props.stageId is the list of stages the user wants to see
					// allowedStages is the list of stages the user is allowed to see
					.$if(Boolean(props.stageId?.length), (qb) =>
						qb.where((eb) => stagesWhere(eb, props.stageId!, "PubsInStages.stageId"))
					)
					.$if(Boolean(allowedStages?.length), (qb) =>
						qb.where((eb) => stagesWhere(eb, allowedStages!, "PubsInStages.stageId"))
					)
					// pub type filter
					// we need to do these checks separately bc just bc you are only allowed to see
					// some pub types, doesn't mean you _want_ to see all pub types
					// props.pubTypeId is the list of pub types the user wants to see
					// allowedPubTypes is the list of pub types the user is allowed to see
					.$if(Boolean(props.pubTypeId?.length), (qb) =>
						qb.where("pubs.pubTypeId", "in", props.pubTypeId!)
					)
					.$if(Boolean(allowedPubTypes?.length), (qb) =>
						qb.where("pubs.pubTypeId", "in", allowedPubTypes!)
					)
					// pub value filter
					.$if(Boolean(options?.filters), (qb) =>
						qb.where((eb) => applyFilters(eb, options!.filters!))
					)
					// custom filter (e.g. jsonata-based)
					.$if(Boolean(options?.customFilter), (qb) =>
						qb.where((eb) => options!.customFilter!(eb))
					)
					.$if(Boolean(orderBy), (qb) => qb.orderBy(orderBy!, orderDirection ?? "desc"))
					.$if(Boolean(limit), (qb) => qb.limit(limit!))
					.$if(Boolean(offset), (qb) => qb.offset(offset!))

					.$if(Boolean(tsQuery), (qb) =>
						qb
							.where((_eb) => sql`pubs."searchVector" @@ ${tsQuery}`)
							.orderBy(sql`ts_rank_cd(pubs."searchVector",${tsQuery}) desc`)
					)
			)
			.selectFrom("pub_tree as pt")
			.select([
				"pt.pubId as id",
				"pt.pubTypeId",
				"pt.depth",
				"pt.stageId",
				"pt.communityId",
				"pt.isCycle",
				"pt.path",
				"pt.createdAt",
				"pt.updatedAt",
				"pt.title",
			])
			.$if(Boolean(tsQuery), (qb) =>
				qb.select((_eb) => [
					sql<string>`ts_headline(
								'${sql.raw(language)}',
								pt.title, 
								${tsQuery}, 
								'${sql.raw(headlineConfig)}'
							)`.as("title"),
				])
			)
			.$if(Boolean(includeSearchValues), (qb) =>
				qb.select((eb) =>
					jsonArrayFrom(
						eb
							.selectFrom("pub_values")
							.innerJoin("pub_fields", "pub_fields.id", "pub_values.fieldId")
							.innerJoin("_PubFieldToPubType", (join) =>
								join
									.onRef("A", "=", "pub_fields.id")
									.onRef("B", "=", "pt.pubTypeId")
							)
							.select([
								"pub_values.value",
								"pub_fields.name",
								"pub_fields.slug",
								"pub_fields.schemaName",
								"_PubFieldToPubType.isTitle",
								sql<string>`ts_headline(
							'${sql.raw(language)}',
							pub_values.value#>>'{}',
							${tsQuery},
							'${sql.raw(headlineConfig)}'
						)`.as("highlights"),
							])
							.$narrowType<{
								value: JsonValue
								// still typed as null in db
								schemaName: CoreSchemaType
							}>()
							.whereRef("pub_values.pubId", "=", "pt.pubId")
							.where(
								(_eb) => sql`to_tsvector(${language}, value#>>'{}') @@ ${tsQuery}`
							)
					).as("matchingValues")
				)
			)
			.$if(Boolean(withValues), (qb) =>
				qb.select((eb) =>
					jsonArrayFrom(
						eb
							.selectFrom("pub_values as pv")
							.innerJoin("pub_fields", "pub_fields.id", "pv.fieldId")
							.$if(Boolean(fieldSlugs), (qb) =>
								qb.where("pub_fields.slug", "in", fieldSlugs!)
							)
							.select([
								"pv.id as id",
								"pv.fieldId",
								"pv.value",
								"pv.rank",
								"pv.relatedPubId",
								"pv.createdAt as createdAt",
								"pv.updatedAt as updatedAt",
								"pub_fields.schemaName",
								"pub_fields.slug as fieldSlug",
								"pub_fields.name as fieldName",
							])
							.whereRef("pv.pubId", "=", "pt.pubId")
							// Order by most recently updated value (grouped by pub field), then rank
							.orderBy([
								(eb) =>
									// Equivalent to: max(pv."updatedAt") over(partition by pv."fieldId") desc
									sql`${eb.fn
										.max("pv.updatedAt")
										.over((ob) => ob.partitionBy("pv.fieldId"))} desc`,
								"pv.rank",
							])
							// filter out relatedPubs with pubTypes/stages that the user does not have access to
							.$if(Boolean(allowedPubTypes?.length || allowedStages?.length), (qb) =>
								qb.where((eb) =>
									eb.or([
										eb("pv.relatedPubId", "is", null),
										eb(
											"pv.relatedPubId",
											"in",
											eb.selectFrom("pub_tree").select("pub_tree.pubId")
										),
									])
								)
							)
					).as("values")
				)
			)
			.$if(Boolean(withRelatedCounts), (qb) =>
				qb.select((eb) =>
					eb
						.selectFrom("pub_values as pv")
						.innerJoin("pub_fields", "pub_fields.id", "pv.fieldId")
						.$if(Boolean(fieldSlugs), (qb) =>
							qb.where("pub_fields.slug", "in", fieldSlugs!)
						)
						.select((eb) =>
							eb.fn.count<number>("pv.relatedPubId").as("relatedPubsCount")
						)
						.whereRef("pv.pubId", "=", "pt.pubId")
						// filter out relatedPubs with pubTypes/stages that the user does not have access to
						.$if(Boolean(allowedPubTypes?.length || allowedStages?.length), (qb) =>
							qb.where((eb) =>
								eb.or([
									eb("pv.relatedPubId", "is", null),
									eb(
										"pv.relatedPubId",
										"in",
										eb.selectFrom("pub_tree").select("pub_tree.pubId")
									),
								])
							)
						)
						.as("relatedPubsCount")
				)
			)
			// TODO: is there a more efficient way to do this?
			.$if(Boolean(withStage), (qb) =>
				qb.select((eb) =>
					jsonObjectFrom(
						eb
							.selectFrom("stages")
							.selectAll("stages")
							.$if(
								withStageAutomations && withStageAutomations.detail === "full",
								(qb) => {
									if (!withStageAutomations)
										throw new Error("withStageAutomations is required")
									return qb.select((eb) =>
										nestedFullAutomationsSelect(
											eb,
											withStageAutomations.filter
										).as("fullAutomations")
									)
								}
							)
							.$if(
								withStageAutomations && withStageAutomations.detail === "base",
								(qb) => {
									if (!withStageAutomations)
										throw new Error("withStageAutomations is required")
									return qb.select((eb) =>
										nestedBaseAutomationsSelect(
											eb,
											withStageAutomations.filter
										).as("baseAutomations")
									)
								}
							)
							.where("pt.stageId", "is not", null)
							.whereRef("stages.id", "=", "pt.stageId")
							.limit(1)
					).as("stage")
				)
			)
			.$if(Boolean(withPubType), (qb) =>
				qb.select((eb) => pubType({ eb, pubTypeIdRef: "pt.pubTypeId" }))
			)
			.$if(Boolean(withMembers), (qb) =>
				qb.select((eb) =>
					jsonArrayFrom(
						eb
							.selectFrom("pub_memberships")
							.whereRef("pub_memberships.pubId", "=", "pt.pubId")
							.innerJoin("users", "users.id", "pub_memberships.userId")
							.select([
								"pub_memberships.role",
								"pub_memberships.formId",
								...SAFE_USER_SELECT,
							])
					).as("members")
				)
			)
			.$if(Boolean(orderBy), (qb) => qb.orderBy(orderBy!, orderDirection ?? "desc"))
			.orderBy("depth asc")
			// this is necessary to filter out all the duplicate entries for the values
			.groupBy([
				"pt.pubId",
				"pt.depth",
				"pt.pubTypeId",
				"pt.updatedAt",
				"pt.createdAt",
				"pt.title",
				"pt.stageId",
				"pt.communityId",
				"pt.isCycle",
				"pt.path",
			])

			.$if(Boolean(count), (qb) =>
				// aggregate count
				// @ts-expect-error just trust me its finneee
				qb
					.clearGroupBy()
					.clearGroupBy()
					.clearSelect()
					.select((eb) => eb.fn.countAll<number>().as("count"))
					.where("pt.depth", "=", 1)
					.groupBy(["pt.depth"])
			),
		{
			// if more than 50 are fetched it likely takes more time to cache/uncache than it does to just execute the query
			skipCacheFn: () => {
				return !options?.limit || options?.limit > 50
			},
		}
	).execute()

	if (options?._debugDontNest) {
		// @ts-expect-error We should not accomodate the return type for this option
		return result
	}

	if (options?.count) {
		// @ts-expect-error We should not accomodate the return type for this option
		return (result?.[0]?.count ?? 0) as number
	}

	if (props.pubId) {
		const nested = nestRelatedPubs(result as UnprocessedPub[], {
			rootPubId: props.pubId,
			...opts,
		}) as ProcessedPub<Options>
		if (opts.withIncomingRelations) {
			await attachIncomingRelations([nested], props.communityId, opts.trx ?? db)
		}
		return nested
	}

	const nested = nestRelatedPubs(result as UnprocessedPub[], {
		...opts,
	}) as ProcessedPub<Options>[]
	if (opts.withIncomingRelations) {
		await attachIncomingRelations(nested, props.communityId, opts.trx ?? db)
	}
	return nested
}

/**
 * Batch-load incoming relations for a set of pubs and attach them directly.
 * For each pub, finds other pubs that reference it via relational fields,
 * grouped by field slug.
 */
/** Minimal pub shape for traversal and incoming-relation attachment. */
type PubWithIncomingRelations = {
	id: PubsId
	values?: { relatedPub?: PubWithIncomingRelations | null }[]
	incomingRelations?: Record<string, ProcessedPub[]>
}

/**
 * Walk a pub tree iteratively, collecting all pubs (including nested related pubs).
 */
function collectAllPubs(roots: PubWithIncomingRelations[]): PubWithIncomingRelations[] {
	const all: PubWithIncomingRelations[] = []
	const seen = new Set<PubsId>()
	const stack = [...roots]
	while (stack.length > 0) {
		const pub = stack.pop()!
		if (seen.has(pub.id)) continue
		seen.add(pub.id)
		all.push(pub)
		for (const v of pub.values ?? []) {
			if (v.relatedPub) stack.push(v.relatedPub)
		}
	}
	return all
}

/**
 * Batch-load incoming relations for a set of pubs and attach them directly.
 * For each pub, finds other pubs that reference it via relational fields,
 * grouped by field slug.
 */
async function attachIncomingRelations(
	roots: PubWithIncomingRelations[],
	communityId: CommunitiesId,
	trx: typeof db
): Promise<void> {
	const allPubs = collectAllPubs(roots)
	if (allPubs.length === 0) return

	const pubIdArray = allPubs.map((p) => p.id)

	// Find all (sourcePubId, fieldSlug, targetPubId) tuples referencing our pubs
	const refs = await trx
		.selectFrom("pub_values as pv")
		.innerJoin("pub_fields as pf", "pf.id", "pv.fieldId")
		.select(["pv.pubId", "pf.slug", "pv.relatedPubId"])
		.where("pv.relatedPubId", "in", pubIdArray)
		.where("pf.communityId", "=", communityId)
		.execute()

	if (refs.length === 0) {
		for (const pub of allPubs) {
			pub.incomingRelations = {}
		}
		return
	}

	// Group: targetPubId -> { fieldSlug -> Set<sourcePubId> }
	const refMap = new Map<string, Map<string, Set<string>>>()
	for (const ref of refs) {
		if (!ref.relatedPubId) continue
		let fieldMap = refMap.get(ref.relatedPubId)
		if (!fieldMap) {
			fieldMap = new Map()
			refMap.set(ref.relatedPubId, fieldMap)
		}
		let pubIds = fieldMap.get(ref.slug)
		if (!pubIds) {
			pubIds = new Set()
			fieldMap.set(ref.slug, pubIds)
		}
		pubIds.add(ref.pubId)
	}

	// Fetch all unique source pubs
	const allSourcePubIds = [...new Set(refs.map((r) => r.pubId))] as PubsId[]
	const sourcePubs = await getPubsWithRelatedValues(
		{ communityId },
		{
			pubIds: allSourcePubIds,
			withValues: true,
			withPubType: true,
			withRelatedPubs: false,
			trx,
		}
	)
	const sourcePubsById = new Map(sourcePubs.map((p) => [p.id, p]))

	// Attach incomingRelations to each pub
	for (const pub of allPubs) {
		const fieldMap = refMap.get(pub.id)
		if (fieldMap) {
			const incomingRelations: Record<string, ProcessedPub[]> = {}
			for (const [fieldSlug, sourcePubIds] of fieldMap) {
				incomingRelations[fieldSlug] = [...sourcePubIds]
					.map((id) => sourcePubsById.get(id as PubsId))
					.filter((p) => p !== undefined)
			}
			pub.incomingRelations = incomingRelations
		} else {
			pub.incomingRelations = {}
		}
	}
}

function nestRelatedPubs<Options extends GetPubsWithRelatedValuesOptions>(
	pubs: UnprocessedPub[],
	options?: {
		rootPubId?: PubsId
	} & Options
): ProcessedPub<Options> | ProcessedPub<Options>[] {
	const opts = {
		...DEFAULT_OPTIONS,
		...options,
	}

	const depth = opts.depth ?? DEFAULT_OPTIONS.depth

	// create a map of all pubs by their ID for easy lookup
	const unprocessedPubsById = new Map<PubsId, UnprocessedPub>()
	for (const pub of pubs) {
		// Only include the first one we found to not overwrite any at lower depths,
		// in the case of a cycle
		if (!unprocessedPubsById.has(pub.id)) {
			unprocessedPubsById.set(pub.id, pub)
		}
	}

	const processedPubsById = new Map<PubsId, ProcessedPub<Options>>()

	function processPub(pubId: PubsId, depth: number): ProcessedPub<Options> | undefined {
		if (depth < 0) {
			return processedPubsById.get(pubId)
		}

		const alreadyProcessedPub = processedPubsById.get(pubId)
		if (alreadyProcessedPub) {
			return alreadyProcessedPub
		}

		const unprocessedPub = unprocessedPubsById.get(pubId)
		if (!unprocessedPub) {
			return undefined
		}

		const processedValues = unprocessedPub.values?.map((value) => {
			const relatedPub = value.relatedPubId ? processPub(value.relatedPubId, depth - 1) : null

			return {
				...value,
				...(relatedPub && { relatedPub }),
			} as ProcessedPub<Options>["values"][number]
		})

		const { values: _values, path: _path, ...usefulProcessedPubColumns } = unprocessedPub

		const processedPub = {
			...usefulProcessedPubColumns,
			values: processedValues ?? [],
		} as ProcessedPub

		const forceCast = processedPub as unknown as ProcessedPub<Options>

		processedPubsById.set(unprocessedPub.id, forceCast)
		return forceCast
	}

	if (opts.rootPubId) {
		// start processing from the root pub
		const rootPub = processPub(opts.rootPubId, depth - 1)
		if (!rootPub) {
			throw PubNotFoundError
		}

		return rootPub
	}

	const topLevelPubs = pubs.filter((pub) => pub.depth === 1)

	return topLevelPubs
		.map((pub) => processPub(pub.id, depth - 1))
		.filter((processedPub) => !!processedPub)
}

export const getPubTitle = (pubId: PubsId, trx = db) =>
	trx
		.selectFrom("pubs")
		.where("pubs.id", "=", pubId)
		.innerJoin("pub_values", "pub_values.pubId", "pubs.id")
		.innerJoin("pub_fields", "pub_fields.id", "pub_values.fieldId")
		.innerJoin("_PubFieldToPubType", "A", "pub_fields.id")
		.where("_PubFieldToPubType.isTitle", "=", true)
		.select("pub_values.value as title")
		.$narrowType<{ title: string }>()

export const stagesWhere = <EB extends ExpressionBuilder<any, any>>(
	eb: EB,
	stages: StageConstraint[],
	column: string
) => {
	const { noStage, stageIds } = Object.groupBy(stages, (stage) =>
		stage === NO_STAGE_OPTION.value ? "noStage" : "stageIds"
	)
	return eb.or([
		...(stageIds && stageIds.length > 0 ? [eb(column, "in", stageIds as StagesId[])] : []),
		...(noStage ? [eb(column, "is", null)] : []),
	])
}

/**
 * Get the number of pubs in a community, optionally additionally filtered by stage and pub type
 */
export const getPubsCount = async (
	props: {
		communityId: CommunitiesId
		stageId?: StageConstraint[]
		pubTypeId?: PubTypesId[]
		userId?: UsersId
	},
	opts?: Pick<
		GetPubsWithRelatedValuesOptions,
		"filters" | "search" | "searchConfig" | "allowedPubTypes" | "allowedStages"
	>
): Promise<number> => {
	const pubsCount = await getPubsWithRelatedValues(
		{
			communityId: props.communityId,
			stageId: props.stageId,
			pubTypeId: props.pubTypeId,
			userId: props.userId,
		},
		{ ...opts, limit: 1_000_000, count: true }
	)

	// @ts-expect-error just trust me its a number
	const count = pubsCount as number

	return count
}
export type FullProcessedPub = ProcessedPub<{
	withRelatedPubs: true
	withMembers: true
	withPubType: true
	withStage: true
	withStageAutomations: {
		detail: "full"
		filter: "all"
	}
}>

export type FullProcessedPubWithForm = ProcessedPubWithForm<{
	withRelatedPubs: true
	withStage: true
	withPubType: true
	withMembers: true
	withStageAutomations: {
		detail: "full"
		filter: "all"
	}
}>

export interface SearchConfig {
	language?: string
	weights?: {
		/**
		 * how much the title field should be weighted when matching the query
		 * @default 1.0
		 */
		A?: number // Title weight
		/**
		 * how much the other fields should be weighted when matching the query
		 * @default 0.5
		 */
		B?: number // Content weight
	}
	/**
	 * whether to also match "database" when you search for "data", or only match on full words
	 * @default true
	 */
	prefixSearch?: boolean
	/**
	 * minimum length of a word to be included in the search
	 * @default 2
	 */
	minLength?: number
	/**
	 * how highlights should be formatted
	 * @default "StartSel=<mark>, StopSel=</mark>, MaxFragments=2"
	 */
	headlineConfig?: string
	/**
	 * how many results to return
	 * @default 10
	 */
	limit?: number
}

const DEFAULT_FULLTEXT_SEARCH_OPTS = {
	language: "english",
	weights: {
		A: 1.0,
		B: 0.5,
	},
	prefixSearch: true,
	minLength: 2,
	limit: 10,
	headlineConfig: "StartSel=<mark>, StopSel=</mark>, MaxFragments=2",
} satisfies SearchConfig

export const createTsQuery = (query: string, config: SearchConfig = {}) => {
	const options = {
		...DEFAULT_FULLTEXT_SEARCH_OPTS,
		...config,
	}

	const { prefixSearch = true, minLength = 2 } = options

	const cleanQuery = query.trim().replace(/[:@]/g, "")
	if (cleanQuery.length < minLength) {
		return null
	}

	const terms = cleanQuery.split(/\s+/).filter((word) => word.length >= minLength)

	if (terms.length === 0) {
		return null
	}

	// this is the most specific match, ie match "quick brown fox" when you search for "quick brown fox"
	const phraseQuery = sql`to_tsquery(${options.language}, ${terms.join(" <-> ")})`

	// all words match but in any order. could perhaps be removed in favor of prefix search
	const exactTerms = terms.join(" & ")
	const exactQuery = sql`to_tsquery(${options.language}, ${exactTerms})`

	// prefix matches, ie match "quick" when you search for "qu"
	// this significantly slows down the query, but makes it much more useful
	const prefixTerms = prefixSearch ? terms.map((term) => `${term}:*`).join(" & ") : null
	const prefixQuery = prefixTerms ? sql`to_tsquery(${options.language}, ${prefixTerms})` : null

	// combine queries
	return sql`(
	  ${phraseQuery} || 
	  ${exactQuery} ${prefixQuery ? sql` || ${prefixQuery}` : sql``}
	)`
}

export const _fullTextSearchQuery = (
	query: string,
	communityId: CommunitiesId,
	_userId: UsersId,
	opts?: SearchConfig
) => {
	const options = {
		...DEFAULT_FULLTEXT_SEARCH_OPTS,
		...opts,
	}

	const tsQuery = createTsQuery(query, options)

	const q = db
		.selectFrom("pubs")
		.select((eb) => [
			"pubs.id",
			"pubs.title",
			"pubs.communityId",
			"pubs.createdAt",
			"pubs.updatedAt",
			"pubs.searchVector",
			// this is the highlighted title
			// possibly non efficient to do this like so
			sql<string>`ts_headline(
								'${sql.raw(options.language)}',
								pubs.title, 
								${tsQuery}, 
								'${sql.raw(options.headlineConfig)}'
							)`.as("titleHighlights"),

			jsonArrayFrom(
				eb
					.selectFrom("pub_values")
					.innerJoin("pub_fields", "pub_fields.id", "pub_values.fieldId")
					.innerJoin("_PubFieldToPubType", (join) =>
						join.onRef("A", "=", "pub_fields.id").onRef("B", "=", "pubs.pubTypeId")
					)
					.select([
						"pub_values.value",
						"pub_fields.name",
						"pub_fields.slug",
						"pub_fields.schemaName",
						"_PubFieldToPubType.isTitle",
						sql<string>`ts_headline(
							'${sql.raw(options.language)}',
							pub_values.value#>>'{}',
							${tsQuery},
							'${sql.raw(options.headlineConfig)}'
						)`.as("highlights"),
					])
					.$narrowType<{
						value: JsonValue
						// still typed as null in db
						schemaName: CoreSchemaType
					}>()
					.whereRef("pub_values.pubId", "=", "pubs.id")
					.where(
						(_eb) => sql`to_tsvector(${options.language}, value#>>'{}') @@ ${tsQuery}`
					)
			).as("matchingValues"),
			jsonObjectFrom(
				eb
					.selectFrom("pub_types")
					.selectAll("pub_types")
					.whereRef("pubs.pubTypeId", "=", "pub_types.id")
			)
				// there will always be a pub type
				.$notNull()
				.as("pubType"),
			jsonObjectFrom(
				eb
					.selectFrom("stages")
					.leftJoin("PubsInStages", "stages.id", "PubsInStages.stageId")
					.select(["stages.id", "stages.name"])
					.whereRef("PubsInStages.pubId", "=", "pubs.id")
					.limit(1)
			).as("stage"),
		])
		.where("pubs.communityId", "=", communityId)
		.where((_eb) => sql`pubs."searchVector" @@ ${tsQuery}`)
		.limit(options.limit)
		.orderBy(
			sql`ts_rank_cd(
		  pubs."searchVector",
		  ${tsQuery}) desc`
		)

	return q
}

export const fullTextSearch = async (
	query: string,
	communityId: CommunitiesId,
	userId: UsersId,
	opts?: SearchConfig
) => {
	const dbQuery = _fullTextSearchQuery(query, communityId, userId, opts)

	if (env.LOG_LEVEL === "debug" && env.KYSELY_DEBUG === "true") {
		const explained = await dbQuery.explain("json", sql`analyze`)
		logger.debug({
			msg: `Full Text Search EXPLAIN`,
			queryPlan: explained[0]["QUERY PLAN"][0],
		})
	}

	return autoCache(dbQuery).execute()
}

export const getExclusivelyRelatedPub = async (relatedPubId: PubsId, relationFieldSlug: string) => {
	return autoCache(
		db
			.with("related_pub_id", (qb) =>
				qb
					.selectFrom("pub_values")
					.innerJoin("pub_fields", "pub_values.fieldId", "pub_fields.id")
					.where("pub_values.relatedPubId", "=", relatedPubId)
					.where("pub_fields.isRelation", "=", true)
					.where("pub_fields.slug", "=", relationFieldSlug)
					.select("pub_values.pubId")
					.limit(1)
			)
			.selectFrom("related_pub_id")
			.innerJoin("pubs", "pubs.id", "related_pub_id.pubId")
			.select((eb) => [
				...pubColumns,
				jsonArrayFrom(
					eb
						.selectFrom("pub_values")
						.innerJoin("pub_fields", "pub_fields.id", "pub_values.fieldId")
						.select([
							"pub_values.id as id",
							"pub_values.fieldId",
							"pub_values.value",
							"pub_values.relatedPubId",
							"pub_values.createdAt as createdAt",
							"pub_values.updatedAt as updatedAt",
							"pub_fields.schemaName",
							"pub_fields.slug as fieldSlug",
							"pub_fields.name as fieldName",
						])
						.whereRef("pub_values.pubId", "=", "pubs.id")
						.orderBy("pub_values.createdAt desc")
				).as("values"),
				pubType({ eb, pubTypeIdRef: "pubs.pubTypeId" }),
			])
	).executeTakeFirst()
}
