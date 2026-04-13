import type {
	AutomationEvent,
	Automations,
	CommunitiesId,
	FormElementsId,
	FormsId,
	InputComponent,
	PubFields,
	PubFieldsId,
	PubsId,
	PubTypes,
	PubTypesId,
	PubValuesId,
	Stages,
	StagesId,
	Users,
	UsersId,
} from "db/public"
import type { FullAutomation } from "db/types"

import z from "zod"

import {
	type CoreSchemaType,
	communitiesIdSchema,
	coreSchemaTypeSchema,
	formElementsSchema,
	formsSchema,
	type MemberRole,
	memberRoleSchema,
	pubFieldsSchema,
	pubsIdSchema,
	pubTypesIdSchema,
	pubTypesSchema,
	pubValuesSchema,
	stagesIdSchema,
	stagesSchema,
	usersIdSchema,
	usersSchema,
} from "db/public"

// Auth types

export const SafeUser = z.object({
	id: usersIdSchema,
	slug: z.string(),
	firstName: z.string(),
	lastName: z.string().nullable(),
	avatar: z.string().nullable(),
	createdAt: z.date(),
})
export type SafeUser = z.infer<typeof SafeUser>

export const User = SafeUser.and(
	z.object({
		email: z.string(),
	})
)
export type User = z.infer<typeof User>

// Json value types taken from prisma
export type JsonObject = { [Key in string]: JsonValue }
export interface JsonArray extends Array<JsonValue> {}
export type JsonValue = string | number | boolean | JsonObject | JsonArray | null
export type InputJsonObject = { readonly [Key in string]?: InputJsonValue | null }
interface InputJsonArray extends ReadonlyArray<InputJsonValue | null> {}
type InputJsonValue =
	| string
	| number
	| boolean
	| InputJsonObject
	| InputJsonArray
	| { toJSON(): unknown }

export type JsonInput = InputJsonValue
export const JsonInput: z.ZodType<JsonInput> = z.lazy(() =>
	z.union([
		z.union([z.string(), z.number(), z.boolean()]),
		z.array(JsonInput),
		z.record(JsonInput),
	])
)
export type JsonOutput = JsonValue
export const JsonOutput = JsonInput as z.ZodType<JsonOutput>

// @see: https://github.com/colinhacks/zod#json-type
const literalSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
type Literal = string | number | boolean | null
export type Json = Literal | { [key: string]: Json } | Json[]
export const jsonSchema: z.ZodType<Json> = z.lazy(() =>
	z.union([literalSchema, z.array(jsonSchema), z.record(jsonSchema)])
)

const commonPubFields = z.object({
	pubTypeId: z.string(),
})

// Get pub types

export const GetPubResponseBody = commonPubFields.extend({
	id: z.string(),
	values: z.record(JsonOutput),
	communityId: z.string(),
	createdAt: z.date(),
})
export type GetPubResponseBody = z.infer<typeof GetPubResponseBody>

// Create pub types

export const CreatePubRequestBody = commonPubFields.extend({
	id: z.string().optional(),
	values: z.record(JsonInput),
})
export type CreatePubRequestBody = z.infer<typeof CreatePubRequestBody>

// TODO: there has to be a better way to allow the API requests to include nulls in json fields
export const CreatePubRequestBodyWithNulls = commonPubFields.extend({
	id: pubsIdSchema.optional(),
	values: z.record(
		z.union([
			jsonSchema.or(z.date()),
			z.object({ value: jsonSchema.or(z.date()), relatedPubId: pubsIdSchema }).array(),
		])
	),
})

export type CreatePubRequestBodyWithNulls = z.infer<typeof CreatePubRequestBodyWithNulls>

export const CreatePubResponseBody = commonPubFields.extend({
	id: z.string(),
})
export type CreatePubResponseBody = z.infer<typeof CreatePubResponseBody>

export const formSchema = formsSchema.extend({
	elements: z.array(
		z
			.object({
				schemaName: z.nullable(coreSchemaTypeSchema),
				slug: z.nullable(z.string()),
				isRelation: z.boolean(),
				fieldName: z.nullable(z.string()),
			})
			.merge(formElementsSchema.omit({ formId: true, createdAt: true, updatedAt: true }))
	),
})

export const TOTAL_PUBS_COUNT_HEADER = "x-total-pubs"

export type CreatePubRequestBodyWithNullsNew = z.infer<typeof CreatePubRequestBodyWithNulls> & {
	stageId?: StagesId
	relatedPubs?: Record<string, { value: Json | Date; pub: CreatePubRequestBodyWithNulls }[]>
	members?: Record<UsersId, MemberRole>
}

export const safeUserSchema = usersSchema.omit({ passwordHash: true }).strict()

const CreatePubRequestBodyWithNullsWithStageId = CreatePubRequestBodyWithNulls.extend({
	stageId: stagesIdSchema.optional(),
	values: z.record(
		jsonSchema
			.or(
				z.array(
					z.object({
						value: jsonSchema.or(z.date()),
						relatedPubId: pubsIdSchema,
					})
				)
			)
			.or(z.date())
	),
	members: (
		z.record(usersIdSchema, memberRoleSchema) as z.ZodType<Record<UsersId, MemberRole>>
	).optional(),
})

export const CreatePubRequestBodyWithNullsNew: z.ZodType<CreatePubRequestBodyWithNullsNew> =
	CreatePubRequestBodyWithNullsWithStageId.extend({
		relatedPubs: z
			.lazy(() =>
				z.record(
					z.array(
						z.object({
							value: jsonSchema.or(z.date()),
							pub: CreatePubRequestBodyWithNullsNew,
						})
					)
				)
			)
			.optional(),
	})

export const upsertPubRelationsSchema = z.record(
	z.array(
		z.union([
			z.object({
				value: jsonSchema.or(z.date()),
				relatedPub: CreatePubRequestBodyWithNullsNew,
			}),
			z.object({ value: jsonSchema.or(z.date()), relatedPubId: pubsIdSchema }),
		])
	)
)

/**
 * Only add the `stage` if the `withStage` option has not been set to `false
 */
type MaybePubStage<Options extends MaybePubOptions> = Options["withStage"] extends true
	? Options["withStageAutomations"] extends {
			detail: infer Detail extends "count" | "full" | "base"
		}
		? {
				stage:
					| (Stages &
							(Detail extends "count"
								? {
										automationsCount: number
										fullAutomations?: never
										baseAutomations?: never
									}
								: Detail extends "full"
									? {
											fullAutomations: FullAutomation[]
											automationsCount?: never
											baseAutomations?: never
										}
									: {
											baseAutomations: Automations[]
											automationsCount?: never
											fullAutomations?: never
										}))
					| null
			}
		: Options["withStageAutomations"] extends true
			? { stage: (Stages & { automations: FullAutomation[] }) | null }
			: { stage: Stages | null }
	: Options["withStage"] extends false
		? { stage?: never }
		: { stage?: Stages | null }

export type PubTypePubField = Pick<
	PubFields,
	"id" | "name" | "slug" | "schemaName" | "isRelation"
> & {
	isTitle: boolean
}
/**
 * Only add the `pubType` if the `withPubType` option has not been set to `false`
 */
type MaybePubPubType<Options extends MaybePubOptions> = Options["withPubType"] extends true
	? {
			pubType: PubTypes & {
				fields: PubTypePubField[]
			}
		}
	: Options["withPubType"] extends false
		? { pubType?: never }
		: { pubType?: PubTypes & { fields: PubTypePubField[] } }

/**
 * Only add the `members` if the `withMembers` option has not been set to `false`
 */
type MaybePubMembers<Options extends MaybePubOptions> = Options["withMembers"] extends true
	? { members: (Omit<Users, "passwordHash"> & { role: MemberRole; formId: FormsId | null })[] }
	: Options["withMembers"] extends false
		? { members?: never }
		: {
				members?: (Omit<Users, "passwordHash"> & {
					role: MemberRole
					formId: FormsId | null
				})[]
			}

type MaybePubRelatedPub<Options extends MaybePubOptions> = Options["withRelatedPubs"] extends false
	? { relatedPub?: never; relatedPubId: PubsId | null }
	: { relatedPub?: ProcessedPub<Options> | null; relatedPubId: PubsId | null }

type MaybePubRelatedCounts<Options extends MaybePubOptions> =
	Options["withRelatedCounts"] extends false
		? { relatedPubsCount?: never }
		: { relatedPubsCount?: number }

type MaybePubIncomingRelations<Options extends MaybePubOptions> =
	Options["withIncomingRelations"] extends true
		? { incomingRelations: Record<string, ProcessedPub[]> }
		: Options["withIncomingRelations"] extends false
			? { incomingRelations?: never }
			: { incomingRelations?: Record<string, ProcessedPub[]> }

export type DetailLevel = "count" | "full" | "base"

export type StageAutomationSelectOptions = {
	detail: DetailLevel
	filter: AutomationEvent[] | "all"
}

/**
 * Those options of `getPubsWithRelatedValuesOptions` that affect the output of `ProcessedPub`
 *
 * This way it's more easy to specify what kind of `ProcessedPub` we want as e.g. the input type of a function
 *
 **/
export type MaybePubOptions = {
	/**
	 * Whether to recursively fetch related pubs.
	 *
	 * @default true
	 */
	withRelatedPubs?: boolean
	/**
	 * Whether to include the pub type.
	 *
	 * @default false
	 */
	withPubType?: boolean
	/**
	 * Whether to include the stage.
	 *
	 * @default false
	 */
	withStage?: boolean
	/**
	 * Whether to include action instances for pub stages.
	 * `true` is the same as `{ detail: "full", filter: "all" }`
	 *
	 * @default false
	 */
	withStageAutomations?: StageAutomationSelectOptions | boolean
	/**
	 * Whether to include members of the pub.
	 *
	 * @default false
	 */
	withMembers?: boolean
	/**
	 * Whether to include the values.
	 *
	 * @default boolean
	 */
	withValues?: boolean
	/**
	 * Whether to include a count of related pubs
	 *
	 * @default false
	 */
	withRelatedCounts?: boolean

	/**
	 * Whether to include incoming relations (other pubs that reference this pub).
	 * When true, each ProcessedPub will have an `incomingRelations` field:
	 * `Record<string, ProcessedPub[]>` keyed by field slug.
	 *
	 * @default false
	 */
	withIncomingRelations?: boolean

	/**
	 * The search query to use for matching values
	 */
	search?: string

	/**
	 * Whether to include matched and highlighted values
	 * @default true if `search` is defined
	 */
	withSearchValues?: boolean
}

/**
 * Information about the field that the value belongs to.
 */
type ValueFieldInfo = {
	schemaName: CoreSchemaType
	fieldId: PubFieldsId
	fieldSlug: string
	fieldName: string
	rank: string | null
}

type ValueBase = {
	id: PubValuesId
	value: unknown
	createdAt: Date
	updatedAt: Date
} & ValueFieldInfo

type ValuesWithFormElements =
	| // With both values and form elements
	(ValueBase & {
			formElementId: FormElementsId
			formElementLabel: string | null
			formElementConfig:
				| { label?: string }
				| { relationshipConfig: { label?: string } }
				| null
			formElementComponent: InputComponent
			formElementRelatedPubTypes: PubTypesId[]
	  })
	// With only value info
	| ValueBase
	// With only form info
	| ({
			id: null
			value: null
			createdAt: null
			updatedAt: null
			formElementId: FormElementsId
			formElementLabel: string | null
			formElementConfig:
				| { label?: string }
				| { relationshipConfig: { label?: string } }
				| null
			formElementComponent: InputComponent
			formElementRelatedPubTypes: PubTypesId[]
	  } & ValueFieldInfo)

type ProcessedPubBase = {
	id: PubsId
	stageId: StagesId | null
	communityId: CommunitiesId
	pubTypeId: PubTypesId
	createdAt: Date
	title: string | null
	depth: number
	isCycle?: boolean
	/**
	 * The `updatedAt` of the latest value, or of the pub if the pub itself has a higher `updatedAt` or if there are no values
	 *
	 * We do this because the Pub itself is rarely if ever changed over time.
	 * TODO: Possibly add the `updatedAt` of `PubsInStages` here as well?
	 * At time of writing (2024/11/04) I don't think that table has an `updatedAt`.
	 */
	updatedAt: Date
}

type MaybeSearchResults<Options extends MaybePubOptions> = Options["search"] extends undefined
	? { matchingValues?: never }
	: Options["withSearchValues"] extends false
		? { matchingValues?: never }
		: {
				matchingValues?: {
					slug: string
					name: string
					value: Json
					isTitle: boolean
					highlights: string
				}[]
			}

export type ProcessedPub<Options extends MaybePubOptions = {}> = ProcessedPubBase & {
	/**
	 * Is an empty array if `withValues` is false
	 */
	values: (ValueBase & MaybePubRelatedPub<Options>)[]
} & MaybePubStage<Options> &
	MaybePubPubType<Options> &
	MaybePubMembers<Options> &
	MaybePubRelatedCounts<Options> &
	MaybePubIncomingRelations<Options> &
	MaybeSearchResults<Options>

export type ProcessedPubWithForm<
	Options extends Omit<MaybePubOptions, "withValues" & { withValues: true }> = {},
> = ProcessedPubBase & {
	values: (ValuesWithFormElements & MaybePubRelatedPub<Options>)[]
} & MaybePubStage<Options> &
	MaybePubPubType<Options> &
	MaybePubMembers<Options> &
	MaybePubRelatedCounts<Options>

export interface NonGenericProcessedPub extends ProcessedPubBase {
	stage?: Stages | null
	pubType?: PubTypes
	values?: (ValueBase & {
		relatedPub?: NonGenericProcessedPub | null
		relatedPubId: PubsId | null
	})[]
	relatedPubCounts?: number
}

export const pubTypeWithFieldsSchema = pubTypesSchema.extend({
	fields: z.array(pubFieldsSchema.extend({ isTitle: z.boolean() })),
})

export const processedPubSchema: z.ZodType<NonGenericProcessedPub> = z.object({
	id: pubsIdSchema,
	stageId: stagesIdSchema.nullable(),
	communityId: communitiesIdSchema,
	pubTypeId: pubTypesIdSchema,
	isCycle: z.boolean().optional(),
	depth: z.number(),
	title: z.string().nullable(),
	values: z.array(
		pubValuesSchema.extend({
			value: jsonSchema,
			fieldSlug: z.string(),
			fieldName: z.string(),
			schemaName: coreSchemaTypeSchema,
			relatedPubId: pubsIdSchema.nullable(),
			relatedPub: z.lazy(() => processedPubSchema.nullish()),
			rank: z.string().nullable(),
		})
	),
	createdAt: z.date(),
	updatedAt: z.date(),
	stage: stagesSchema.nullish(),
	pubType: pubTypeWithFieldsSchema.optional(),
	relatedPubCounts: z.number().optional(),
})

export const preferRepresentationHeaderSchema = z.object({
	Prefer: z
		.enum(["return=representation", "return=minimal"])
		.describe(
			"Whether to return the full representation of the updated resource. Defaults to `return=representation`, which will return the updated resource. If you want to avoid returning the updated resource, set this to `return=minimal`. This saves bandwidth, and is usually slightly faster."
		)
		.optional()
		.default("return=minimal"),
})

export const filterOperators = [
	"$eq",
	"$eqi",
	"$ne",
	"$nei",
	"$lt",
	"$lte",
	"$gt",
	"$gte",
	"$contains",
	"$notContains",
	"$containsi",
	"$notContainsi",
	"$exists",
	"$null",
	"$notNull",
	"$in",
	"$notIn",
	"$between",
	"$startsWith",
	"$startsWithi",
	"$endsWith",
	"$endsWithi",
	"$jsonPath", // json path (maybe dangerous),
] as const

export type FilterOperator = (typeof filterOperators)[number]

export const logicalOperators = ["$and", "$or", "$not"] as const

export type LogicalOperator = (typeof logicalOperators)[number]

export type BaseFilter = {
	[O in FilterOperator]?: unknown
}

/**
 * at the slug level, you can do something like
 *
 * ```ts
 * {
 *  title: {
 *    $or: [
 *      { $contains: "value" },
 *      { $contains: "value2" }
 *    ]
 *  }
 * }
 * ```
 *
 * or
 *
 * ```ts
 * {
 *  title: {
 *    $or: { $contains: "value", $contains: "value2" }
 *  }
 * }
 * ```
 *
 * or
 *
 * ```ts
 * {
 *  title: { $not: { $contains: "value" } }
 * }
 */
export type FieldLevelLogicalFilter = {
	$and?: FieldLevelFilter | FieldLevelFilter[]
	$or?: FieldLevelFilter | FieldLevelFilter[]
	$not?: FieldLevelFilter
}

/**
 * At the top level, you can do something like
 *
 * ```ts
 * {
 *  $and: [
 *    { $eq: "value" },
 *    { $eq: "value2" }
 *  ]
 * }
 * ```
 *
 * or nested
 *
 * ```ts
 * {
 *  $or: [
 *    { $or: [
 *      { title: { $eq: "value" } },
 *      { content: { $eq: "value2" } }
 *    ]},
 *    { title: { $contains: "value3" } }
 *  ]
 * }
 * ```
 *
 * or, instead of an array, you can use a single filter
 *
 * // this is the same if you would remove $and
 * ```ts
 * {
 *  $and: {
 *    title: { $eq: "value" },
 *    content: { $contains: "value2" }
 *  }
 * }
 * ```
 *
 * `$not` always takes an object, not an array
 *
 * ```ts
 * {
 *  $not: {
 *    $and: [
 *      { title: { $eq: "value" } },
 *      { content: { $contains: "value2" } }
 *    ]
 *  }
 * }
 * ```
 *
 */
export type TopLevelLogicalFilter = {
	$and?: Filter[] | Filter
	$or?: Filter[] | Filter
	$not?: Filter
}

/**
 * & here, because you can mix and match field level operators and top level logical operators
 */
export type FieldLevelFilter = BaseFilter & FieldLevelLogicalFilter

export type SlugKeyFilter = {
	[slug: string]: FieldLevelFilter
}

/**
 * | here, because you can only have either a slug key filter or a top level logical filter
 */
export type Filter = SlugKeyFilter | TopLevelLogicalFilter

const coercedNumber = z.coerce.number()
const coercedBoolean = z.enum(["true", "false"]).transform((val) => val === "true")
const coercedDate = z.coerce.date()

const allSchema = z.union([coercedNumber, coercedBoolean, coercedDate, z.string()])

const numberOrDateSchema = z.coerce.number().or(z.coerce.date())

export const baseFilterSchema = z
	.object({
		$eq: allSchema.describe("Equal to"),
		$eqi: z.string().describe("Equal to (case insensitive)"),
		$ne: allSchema.describe("Not equal to"),
		$nei: z.string().describe("Not equal to (case insensitive)"),
		$lt: numberOrDateSchema.describe("Less than"),
		$lte: numberOrDateSchema.describe("Less than or equal to"),
		$gt: numberOrDateSchema.describe("Greater than"),
		$gte: numberOrDateSchema.describe("Greater than or equal to"),
		$contains: z.string().describe("Contains"),
		$notContains: z.string().describe("Does not contain"),
		$containsi: z.string().describe("Contains (case insensitive)"),
		$notContainsi: z.string().describe("Does not contain (case insensitive)"),
		$null: z
			.string()
			.transform(() => true)
			.describe("Is null"),
		$notNull: z
			.string()
			.transform(() => true)
			.describe("Is not null"),
		$exists: coercedBoolean.describe("Exists"),
		$in: z.array(allSchema).describe("In"),
		$notIn: z.array(allSchema).describe("Not in"),
		$between: z.tuple([numberOrDateSchema, numberOrDateSchema]).describe("Between"),
		$startsWith: z.string().describe("Starts with"),
		$startsWithi: z.string().describe("Starts with (case insensitive)"),
		$endsWith: z.string().describe("Ends with"),
		$endsWithi: z.string().describe("Ends with (case insensitive)"),
		$size: z.number().describe("Size"),
		$jsonPath: z
			.string()
			.describe(
				"You can use this to filter more complex json fields, like arrays. See the Postgres documentation for more detail.\n" +
					'Example: `filters[community-slug:jsonField][$jsonPath]="$[2] > 90"`\n' +
					"This will filter the third element in the array, and check if it's greater than 90."
			),
	})
	// .passthrough()
	.partial() satisfies z.ZodType<{
	[K in FilterOperator]?: any
}>

const fieldSlugSchema = z.string()
// .regex(/^[a-zA-Z0-9_.:-]+$/, "At this level, you can only use field slugs");

const baseFilterSchemaWithAndOr: z.ZodType<FieldLevelFilter> = z
	.lazy(() =>
		baseFilterSchema
			.extend({
				$and: z.array(baseFilterSchemaWithAndOr).or(baseFilterSchemaWithAndOr),
				$or: z.array(baseFilterSchemaWithAndOr).or(baseFilterSchemaWithAndOr),
				$not: baseFilterSchemaWithAndOr,
			})
			.partial()
	)
	.superRefine((data, ctx) => {
		if (!Object.keys(data).length) {
			ctx.addIssue({
				path: ctx.path,
				code: z.ZodIssueCode.custom,
				message: "Filter must have at least one operator (base filter)",
			})
			return false
		}
		return true
	})

export const filterSchema: z.ZodType<Filter> = z.lazy(() => {
	const schema = z
		.union([
			z.record(fieldSlugSchema, baseFilterSchemaWithAndOr),
			z
				.object({
					$and: filterSchema.or(z.array(filterSchema)),
					$or: filterSchema.or(z.array(filterSchema)),
					$not: filterSchema,
				})
				.partial(),
		])
		// ideally this would be `.and`, st you can have both fieldSlugs and topLevelLogicalOperators on the same level, but
		// zod does not really support this
		.superRefine((data, ctx) => {
			if (!Object.keys(data).length) {
				ctx.addIssue({
					path: ctx.path,
					code: z.ZodIssueCode.custom,
					message: "Filter must have at least one operator",
				})
				return false
			}
			return true
		})

	return schema
})

export const getPubQuerySchema = z.object({
	depth: z
		.number()
		.int()
		.positive()
		.default(2)
		.describe(
			"The depth to which to fetch children and related pubs. Defaults to 2, which means to fetch the top level pub and one degree of related pubs."
		),
	withChildren: z.boolean().default(false).describe("Whether to fetch children."),
	withRelatedPubs: z
		.boolean()
		.default(false)
		.describe("Whether to include related pubs with the values"),
	withPubType: z.boolean().default(false).describe("Whether to fetch the pub type."),
	withStage: z.boolean().default(false).describe("Whether to fetch the stage."),
	withSearchValues: z.boolean().default(false).describe("Whether to show highlighted values."),
	withValues: z.boolean().default(true).describe("Whether to fetch the pub's values."),
	withMembers: z.boolean().default(false).describe("Whether to fetch the pub's members."),
	fieldSlugs: z
		.array(z.string())
		// this is necessary bc the query parser doesn't handle single string values as arrays
		.or(z.string().transform((slug) => [slug]))
		.optional()
		.describe(
			"Which field values to include in the response. Useful if you have very large pubs or want to save on bandwidth."
		),
})

export type FTSReturn = {
	id: PubsId
	createdAt: Date
	updatedAt: Date
	communityId: CommunitiesId
	title: string | null
	searchVector: string | null
	stage: {
		id: StagesId
		name: string
	} | null
	pubType: {
		id: PubTypesId
		createdAt: Date
		updatedAt: Date
		communityId: CommunitiesId
		name: string
		description: string | null
	}
	titleHighlights: string
	matchingValues: {
		slug: string
		name: string
		value: Json
		isTitle: boolean
		highlights: string
	}[]
}

export const ftsReturnSchema = z.object({
	id: pubsIdSchema,
	createdAt: z.date(),
	updatedAt: z.date(),
	communityId: communitiesIdSchema,
	title: z.string().nullable(),
	searchVector: z.string().nullable(),
	stage: z
		.object({
			id: stagesIdSchema,
			name: z.string(),
		})
		.nullable(),
	pubType: pubTypesSchema,
	titleHighlights: z.string(),
	matchingValues: z.array(
		z.object({
			slug: z.string(),
			name: z.string(),
			value: jsonSchema,
			isTitle: z.boolean(),
			highlights: z.string(),
			schemaName: coreSchemaTypeSchema,
		})
	),
}) satisfies z.ZodType<FTSReturn>

export const zodErrorSchema = z.object({
	name: z.string(),
	issues: z.array(
		z.object({
			code: z.string(),
			expected: z.string(),
			received: z.string(),
			path: z.array(z.string()),
			message: z.string(),
		})
	),
})
