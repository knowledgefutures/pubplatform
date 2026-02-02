import type { Static } from "@sinclair/typebox"
import type { Prettify } from "@ts-rest/core"
import type { ProcessedPub } from "contracts"
import type {
	ActionInstances,
	ActionInstancesId,
	ApiAccessScope,
	ApiAccessTokensId,
	ApiAccessType,
	AutomationEvent,
	Automations,
	AutomationsId,
	AutomationTriggers,
	Communities,
	CommunitiesId,
	CommunityMemberships,
	ConditionEvaluationTiming,
	FormAccessType,
	FormElements,
	Forms,
	FormsId,
	InvitesId,
	NewCommunityMemberships,
	PubFields,
	PubsId,
	PubTypes,
	PubTypesId,
	Stages,
	StagesId,
	Users,
	UsersId,
} from "db/public"
import type {
	ApiAccessPermissionConstraints,
	Invite,
	NewInviteInput,
	permissionsSchema,
} from "db/types"
import type {
	componentConfigSchemas,
	componentsBySchema,
	InputTypeForCoreSchemaType,
} from "schemas"
import type { IconConfig } from "ui/dynamic-icon"
import type { MaybeHas } from "utils/types"
import type z from "zod"
import type { actions } from "~/actions/api"
import type { ConditionBlockFormValue } from "~/app/c/[communitySlug]/stages/manage/components/panel/automationsTab/ConditionBlock"

import { faker } from "@faker-js/faker"
import { jsonArrayFrom } from "kysely/helpers/postgres"

import {
	type Action as ActionName,
	type AutomationConditionBlockType,
	type CoreSchemaType,
	type ElementType,
	type InputComponent,
	MemberRole,
	type StructuralFormElement,
} from "db/public"
import { newInviteSchema } from "db/types"
import { logger } from "logger"
import { expect } from "utils"

import { db } from "~/kysely/database"
import { createPasswordHash } from "~/lib/authentication/password"
import { getAutomationBase } from "~/lib/db/queries"
import { createLastModifiedBy } from "~/lib/lastModifiedBy"
import { findRanksBetween } from "~/lib/rank"
import { createPubRecursiveNew } from "~/lib/server"
import {
	allPermissions,
	createApiAccessToken,
	createSiteBuilderToken,
} from "~/lib/server/apiAccessTokens"
import { insertForm } from "~/lib/server/form"
import { InviteService } from "~/lib/server/invites/InviteService"
import { insertCommunityMemberships, insertStageMemberships } from "~/lib/server/member"
import { createMoveConstraint, createStage } from "~/lib/server/stages"
import { generateToken } from "~/lib/server/token"
import { addUser } from "~/lib/server/user"
import { slugifyString } from "~/lib/string"

export type PubFieldsInitializer = Record<
	string,
	{
		relation?: true
		schemaName: CoreSchemaType
	}
>

export type PubTypeInitializer<PF extends PubFieldsInitializer> = Record<
	string,
	| Partial<Record<keyof PF, { isTitle: boolean }>>
	| {
			id: PubTypesId
			fields: Partial<Record<keyof PF, { isTitle: boolean }>>
	  }
>

/**
 * If left empty, it will be filled out by `faker`,
 * except the `role`, which will be set to `MemberRole.editor` by default.
 * Set to `null` if you don't want to add the user as a member
 */
export type UsersInitializer = Record<
	string,
	| {
			/**
			 * @default randomUUID
			 */
			id?: UsersId
			email?: string
			/** Plain string, will be hashed */
			password?: string
			firstName?: string
			lastName?: string
			avatar?: string
			role?: MemberRole | null
			isSuperAdmin?: boolean
			slug?: string
			existing?: false
			/**
			 * @default true
			 */
			isVerified?: boolean
	  }
	| {
			/** reference an existing user by id */
			id: UsersId
			existing: true
			role?: MemberRole | null
	  }
	| {
			/** reference an existing user by slug */
			slug: string
			existing: true
			role?: MemberRole | null
	  }
	| {
			/** reference an existing user by email */
			email: string
			existing: true
			role?: MemberRole | null
	  }
>

export type AutomationInitializer = {
	[AutomationName in string]: {
		id?: AutomationsId
		icon?: IconConfig
		sourceAutomation?: AutomationName
		timing?: ConditionEvaluationTiming
		condition?: {
			type: AutomationConditionBlockType
			items: ConditionItemInput[]
		}
		/**
		 * A JSONata expression to resolve a Pub or transform JSON input.
		 *
		 * This expression is evaluated before actions run and can:
		 * - Resolve a different Pub using comparisons like `$.json.some.id = $.pub.values.fieldname`
		 * - Transform JSON input into a new structure for actions
		 *
		 * The resolved value overwrites the initial pub/json context for action execution.
		 */
		resolver?: string
		triggers: {
			event: AutomationEvent
			config: unknown
			sourceAutomation?: AutomationName
		}[]
		actions: {
			[A in ActionName]: {
				/**
				 * @default randomUUID
				 */
				id?: ActionInstancesId
				action: A
				name?: string
				config: (typeof actions)[A]["config"]["schema"]["_input"]
			}
		}[keyof typeof actions][]
	}
}

type ConditionItemInput =
	| {
			kind: "condition"
			type: "jsonata"
			expression: string
	  }
	| {
			kind: "block"
			type: AutomationConditionBlockType
			items: ConditionItemInput[]
	  }

/**
 * Map of stagename to list of permissions
 */
export type StagesInitializer<
	U extends UsersInitializer,
	A extends AutomationInitializer = AutomationInitializer,
> = Record<
	string,
	{
		id?: StagesId
		members?: {
			[M in keyof U]?: MemberRole
		}
		automations?: A
		// automations?: {
		// }[];
	}
>

export type StageConnectionsInitializer<S extends StagesInitializer<any>> = Partial<
	Record<
		keyof S,
		{
			to?: (keyof S)[]
			from?: (keyof S)[]
		}
	>
>

export type PubInitializer<
	PF extends PubFieldsInitializer,
	PT extends PubTypeInitializer<PF>,
	U extends UsersInitializer,
	S extends StagesInitializer<U>,
> = {
	[PubTypeName in keyof PT]: {
		/**
		 * @default randomUUID
		 */
		id?: PubsId
		/**
		 * The name of the pubType you specified in the pubTypes object.
		 */
		pubType: PubTypeName
		/**
		 * Values can be a simple object of `FieldName: value`
		 * Or they can directly specify a relation by setting `value` and `relatedPubId`
		 */
		values: {
			[FieldName in keyof PT[PubTypeName] as FieldName extends keyof PF
				? FieldName
				: never]?: FieldName extends keyof PF
				? PF[FieldName]["schemaName"] extends CoreSchemaType
					?
							| InputTypeForCoreSchemaType<PF[FieldName]["schemaName"]>
							| {
									value: InputTypeForCoreSchemaType<PF[FieldName]["schemaName"]>
									/**
									 * Note: this PubId reference a pub at least one level higher than the current pub, or it must be created before this pub.
									 */
									relatedPubId: PubsId
							  }[]
					: never
				: never
		}
		/**
		 * The stages this pub is in.
		 */
		stage?: keyof S
		/**
		 * The members of the pub.
		 * Users are referenced by their keys in the users object.
		 */
		members?: {
			[M in keyof U]?: MemberRole
		}
		/**
		 * Relations can be specified inline
		 *
		 * @example
		 * ```ts
		 * {
		 * 	relatedPubs: {
		 * 		// relatedPubs need to be mapped to a certain field
		 * 		Contributors: [{
		 * 			value: 0,
		 * 			// this will also add the same pub as a child
		 * 			pub: {
		 * 				pubType: "Author",
		 * 				values: {
		 * 					Name: "John Doe",
		 * 				}
		 * 			}
		 * 		}]
		 * 	}
		 * }
		 * ```
		 */
		relatedPubs?: {
			[FieldName in keyof PT[PubTypeName] as FieldName extends keyof PF
				? FieldName
				: never]?: FieldName extends keyof PF
				? PF[FieldName]["schemaName"] extends CoreSchemaType
					? PF[FieldName]["relation"] extends true
						? {
								/**
								 * Acts as relation metadata
								 */
								value?: InputTypeForCoreSchemaType<PF[FieldName]["schemaName"]>
								pub: PubInitializer<PF, PT, U, S>
							}[]
						: never
					: never
				: never
		}
	}
}[keyof PT & string]

export type FormElementInitializer<
	PF extends PubFieldsInitializer,
	PT extends PubTypeInitializer<PF>,
> = {
	[FieldName in keyof PF]: (typeof componentsBySchema)[PF[FieldName]["schemaName"]][number] extends infer Component
		? {
				type: ElementType.pubfield
				field: FieldName
				component: PF[FieldName]["schemaName"] extends CoreSchemaType.Null
					? null
					: Component extends InputComponent
						? Component
						: null
				content?: never
				element?: never
				label?: never
				// sorry for the mess, but basically
				// 1. if the field is a relation, we need to set the relationshipConfig
				// 2. if the field is Null type, we set the baseConfig to empty object
				// ideally i'd do (2) by just checking whether the component is defined (Null has no component) but that doesn't seem to work
				config: Prettify<
					(PF[FieldName]["schemaName"] extends CoreSchemaType.Null
						? {}
						: Component extends InputComponent
							? Static<(typeof componentConfigSchemas)[Component]>
							: {}) &
						(PF[FieldName]["relation"] extends true
							? {
									relationshipConfig: {
										label: string
										help: string
										component: InputComponent.relationBlock
									}
								}
							: {
									relationshipConfig?: never
								})
				>
			} & (PF[FieldName]["relation"] extends true
				? {
						/**
						 * The pub types that can be related through this field.
						 * Min 1 pub type is required.
						 */
						relatedPubTypes: [keyof PT, ...(keyof PT)[]]
					}
				: { relatedPubTypes?: never })
		: never
}[keyof PF]

export type FormInitializer<
	PF extends PubFieldsInitializer,
	PT extends PubTypeInitializer<PF>,
	U extends UsersInitializer,
	SI extends StagesInitializer<U>,
> = {
	[FormTitle in string]: {
		[PubType in keyof PT]: {
			/**
			 * @default randomUUID
			 */
			id?: FormsId
			access?: FormAccessType
			/**
			 * @default false
			 */
			isArchived?: boolean
			slug?: string
			pubType: PubType
			/**
			 * This will add grant form access to the specified users if they are comm:cons.
			 */
			members?: (keyof {
				[K in keyof U as U[K]["role"] extends MemberRole.contributor ? K : never]: K
			})[]
			/**
			 * @default false
			 */
			isDefault?: boolean
			elements: (
				| FormElementInitializer<PF, PT>
				| {
						type: ElementType.structural
						element: StructuralFormElement
						content: string
						component?: never
						label?: never
						config?: never
						field?: never
						relatedPubTypes?: never
				  }
				| {
						type: ElementType.button
						element?: never
						component?: never
						label: string
						content: string
						stage: keyof SI
						config?: never
						field?: never
						relatedPubTypes?: never
				  }
			)[]
		}
	}[keyof PT]
}

export type ApiTokenInitializer = {
	[ApiTokenName in string]: {
		id?: `${string}.${string}`
		description?: string
		permissions?: Partial<z.infer<typeof permissionsSchema>> | true
	}
}

export type InviteInitializer<
	PF extends PubFieldsInitializer,
	PT extends PubTypeInitializer<PF>,
	U extends UsersInitializer,
	SI extends StagesInitializer<U>,
	FI extends FormInitializer<PF, PT, U, SI>,
> = {
	[InviteName in string]: MaybeHas<
		Omit<
			NewInviteInput,
			| "communityId"
			| "lastModifiedBy"
			| "pubFormSlugs"
			| "stageFormSlugs"
			| "communityFormSlugs"
		>,
		"token"
	> & {
		pubFormSlugs?: (keyof FI)[]
		stageFormSlugs?: (keyof FI)[]
		communityFormSlugs?: (keyof FI)[]
	}
}

type CreatePubRecursiveInput = Parameters<typeof createPubRecursiveNew>[0]

const makePubInitializerMatchCreatePubRecursiveInput = <
	PI extends PubInitializer<any, any, any, any>,
>({
	community,
	pubTypes,
	users,
	stages,
	pubs,
	trx,
}: {
	community: Communities
	pubTypes: PubTypes[]
	users: Users[]
	stages: Stages[]
	pubs: PI[]
	trx?: typeof db
}): CreatePubRecursiveInput[] => {
	const result = pubs.map((pub) => {
		const pubType = pubTypes.find((pubType) => pubType.name === pub.pubType)
		if (!pubType) {
			throw new Error(
				`Pub type ${pub.pubType as string} not found in the output of the created pub types.`
			)
		}

		const stageId = stages.find((stage) => stage.name === pub.stage)?.id

		if (pub.stage && !stageId) {
			throw new Error(
				`Stage ${pub.stage as string} not found in the output of the created stages.`
			)
		}

		const values = Object.fromEntries(
			Object.entries(pub.values).map(([valueTitle, info]) => [
				`${community.slug}:${slugifyString(valueTitle)}`,
				info,
			])
		)

		const members = Object.fromEntries(
			Object.entries(pub.members ?? {}).map(
				([slug, role]) => [findBySlug(users, slug)?.id, role] as const
			)
		) as Record<UsersId, MemberRole>

		const rootPubId = pub.id ?? (crypto.randomUUID() as PubsId)

		const relatedPubs = pub.relatedPubs
			? Object.fromEntries(
					Object.entries(pub.relatedPubs)
						.filter(([, info]) => !!info)
						.map(([valueTitle, info]) => [
							`${community.slug}:${slugifyString(valueTitle)}`,
							expect(
								info,
								`Got unexpected empty related pub definition for ${valueTitle}`
							).map((info) => ({
								value: info.value,
								pub: makePubInitializerMatchCreatePubRecursiveInput({
									pubTypes,
									users,
									stages,
									community,
									pubs: [
										{
											...info.pub,
										},
									],
									trx,
								})[0].body,
							})),
						])
				)
			: undefined

		const input = {
			communityId: community.id,
			trx,
			body: {
				id: rootPubId,
				pubTypeId: pubType.id,
				stageId: stageId,
				values,
				members,
				relatedPubs: relatedPubs,
			},
			lastModifiedBy: createLastModifiedBy("system"),
		} satisfies CreatePubRecursiveInput

		return input as CreatePubRecursiveInput
	})

	return result
}

const findBySlug = <T extends { slug: string }>(props: T[], slug: string) =>
	props.find((prop) => new RegExp(`^${slug}`).test(prop.slug))

type CommunitySeedInput = {
	id?: CommunitiesId
	name: string
	slug: string
	avatar?: string
}

// ========
// These are helper types to make the output of the seeding functions match the input more closely.
type PubFieldsByName<PF, withRank extends boolean = false> = {
	[K in keyof PF]: PF[K] &
		Omit<PubFields, "name"> & { name: K } & { isTitle?: boolean } & (withRank extends true
			? { rank: string }
			: {})
}

type PubTypesByName<PT, PF> = {
	[K in keyof PT]: Omit<PubTypes, "name"> & { name: K } & {
		fields: PubFieldsByName<PF, true>
		defaultForm: { slug: string }
	}
}

type UsersBySlug<U extends UsersInitializer> = {
	[K in keyof U]: U[K] & Users
}

type StagesWithPermissionsAndActionsAndAutomationsByName<
	U extends UsersInitializer,
	S extends StagesInitializer<U>,
	StagePermissions,
> = {
	[K in keyof S]: Omit<Stages, "name"> & { name: K } & {
		permissions: StagePermissions
	} & ("automations" extends keyof S[K]
			? {
					automations: {
						[KK in keyof S[K]["automations"]]: Automations & {
							actionInstances: ActionInstances[]
							triggers: AutomationTriggers[]
							conditionBlocks?: Array<{
								id: string
								type: AutomationConditionBlockType
								items: any[]
							}>
						}
					}
				}
			: {})
}

type FormsByName<F extends FormInitializer<any, any, any, any>> = {
	[K in keyof F]: Omit<Forms, "name" | "pubType" | ""> & { name: K } & {
		elements: (F[K]["elements"][number] & FormElements)[]
	}
}

export type InvitesByName<II extends InviteInitializer<any, any, any, any, any>> = {
	[InviteName in keyof II]: Invite & { inviteToken: string }
}

// ===================================

/**
 * Create a community in a typesafe way
 *
 */
export async function seedCommunity<
	const PF extends PubFieldsInitializer,
	const PT extends PubTypeInitializer<PF>,
	const U extends UsersInitializer,
	const S extends StagesInitializer<U>,
	const SC extends StageConnectionsInitializer<S>,
	const PI extends PubInitializer<PF, PT, U, S>[],
	const F extends FormInitializer<PF, PT, U, S>,
	const AI extends ApiTokenInitializer,
	const II extends InviteInitializer<PF, PT, U, S, F>,
>(
	props: {
		/**
		 * The community to create
		 *
		 * If `options.randomSlug` is not `false`, the current date will be added to the end
		 * of the slug to prevent some collisions during testing.
		 *
		 * @example
		 * ```ts
		 * community: {
		 * 	name: "My Community",
		 * 	slug: "my-community",
		 * }
		 * ```
		 */
		community: CommunitySeedInput
		/**
		 * The pub fields of the community
		 *
		 * The keys of the object are the names of the pub fields.
		 * They are slugified and prefixed with the community slug automatically.
		 *
		 * @example
		 * ```ts
		 * {
		 * 		pubFields: {
		 * 			Name: { schemaName: CoreSchemaType.String },
		 * 		// Specify a relation by setting `relation` to `true`
		 * 		// The schema name will then be the schema of the relation metadata
		 * 			Contributors: { schemaName: CoreSchemaType.StringArray, relation: true },
		 * 	}
		 * }
		 * ```
		 */
		pubFields?: PF
		/**
		 * The pub types of the community
		 * Cannot be specified without `pubFields`
		 *
		 * @example
		 * ```ts
		 * {
		 * 	pubFields: {
		 * 		Title: { schemaName: CoreSchemaType.String },
		 * 	},
		 * 	pubTypes: {
		 * 		Article: {
		 * 			Title: { isTitle: true },
		 * 		}
		 * }
		 * ```
		 */
		pubTypes?: PT
		/**
		 * An object where the keys are the slugs of the users and the values are the user objects.
		 *
		 * Will also automatically create members for these users if `role` is specified
		 * Non-filled out fields will be auto-generated.
		 *
		 * If `options.randomSlug` is not `false`, the current date will be added to the end
		 * of the slug to prevent some collisions during testing.
		 *
		 * Example
		 *
		 * ```ts
		 * {
		 * 	users: {
		 * 		john: {
		 * 			firstName: "John",
		 * 			role: MemberRole.Admin,
		 * 			password: "john-password",
		 * 			email: "john@example.com",
		 * 		}
		 * 	}
		 * }
		 * ```
		 * This will output
		 * ```ts
		 * {
		 * 	john: {
		 * 		slug: "john",
		 * 		firstName: "John",
		 * 		lastName: "Some random lastName",
		 * 		avatar: "https://example.com/avatar.png",
		 * 		passwordHash: "hashed-password",
		 * 		email: "john@example.com",
		 * 		member: {
		 * 			id: "123",
		 * 			role: MemberRole.Admin,
		 * 		}
		 * 	}
		 * ```
		 */
		users?: U
		/**
		 * The stages of the community.
		 * You need to have defined users to be able to create stages.
		 *
		 *
		 * You can specify both members and actions for stages.
		 * The options for members are the keys of the users object.
		 *
		 * You can reference e.g. ids like so
		 *
		 * @example
		 * ```ts
		 * const testUserId = crypto.randomUUID() as UsersId;
		 * {
		 * 	users: {
		 * 		john: {
		 * 			id: testUserId,
		 * 		}
		 * 	},
		 * 	stages: {
		 * 		Idea: {
		 * 			members: ["john"],
		 * 			actions: [
		 * 				{
		 * 					action: Action.email,
		 * 					config: {
		 * 						body: "hello world",
		 * 						subject: "hello",
		 * 						recipient: testUserId,
		 * 					},
		 * 				},
		 * 			],
		 * 		}
		 * 	}
		 * }
		 */
		stages?: S
		/**
		 * The stage connections of the community.
		 *
		 * ```ts
		 * {
		 * 	stages: {
		 * 		Submitted: {},
		 * 		Review: {},
		 * 	},
		 * 	stageConnections: {
		 * 		Submitted: {
		 * 			to: ["Review"],
		 * 		}
		 * 	}
		 * }
		 */
		stageConnections?: SC
		/**
		 * The pubs of the community.
		 * One of the few configuration options that is an array instead of an object,
		 * because Pubs do not have a name or a slug which could act as keys.
		 * 
		 * All Pubs are created sequentially, so if you give earlier pubs a specific ID, you
		 * can reference them later

		 * Example
		 * ```ts
		 * 	const authorId= crypto.randomUUID() as PubsId;
		 * {
		 * 	pubs: [
		 * 		{
		 * 			id: authorId,
		 * 			pubType: "Author",
		 * 			values: {
		 * 				Name: "John Doe",
		 * 			}
		 * 		},
		 * 		{
		 * 			id: articlePubId,
		 * 			pubType: "Article",
		 * 			values: {
		 * 				Title: "A Great Article",
		 * 				// relations can be specified directly by Id as a value
		 * 				// the referenced pub needs to be created beforehand
		 * 				Contributors: {
		 * 					value: "Editing",
		 * 					relatedPubId: authorId,
		 * 				}
		 * 			},
		 * 			// or relations can be specified by a nested pub
		 * 			relatedPubs: {
		 * 				// relatedPubs need to be mapped to a certain field
		 * 				Contributors: [{
		 * 					value: "Draft preparation",
		 * 					pub: {
		 * 						pubType: "Author",
		 * 						values: {
		 * 							Name: "John Doe",
		 * 						}
		 * 					}
		 * 				}]
		 * 			}
		 * 		},
		 * 	]
		 * }
		 * ```
		 */
		pubs?: PI
		forms?: F
		apiTokens?: AI
		invites?: II
	},
	options?: {
		/**
		 * Whether or not to add a random number to the end of slugs, helps prevent errors during testing.
		 * @default true
		 */
		randomSlug?: boolean
		/**
		 * Whether or not to create pubs in parallel.
		 * It's set to `false` by default as it allows you to reference related pubs, so only use this if you aren't creating interlinked references between pubs.
		 *
		 * @default false
		 */
		parallelPubs?: boolean
	},
	trx = db
) {
	const { community } = props

	const randomSlugSuffix = options?.randomSlug === false ? "" : `-${crypto.randomUUID()}`

	logger.info(`Starting seed for ${community.name}`)

	const createdCommunity = await trx
		.insertInto("communities")
		.values({
			...community,
			slug: `${community.slug}${randomSlugSuffix}`,
		})
		.returningAll()
		.executeTakeFirstOrThrow()

	const { id: communityId, slug: communitySlug } = createdCommunity

	const pubFieldsList = Object.entries(props.pubFields ?? {})

	const createdPubFields = pubFieldsList.length
		? await trx
				.insertInto("pub_fields")
				.values(
					pubFieldsList.map(([name, info]) => {
						const slug = slugifyString(name)
						return {
							name: name,
							slug: `${communitySlug}:${slug}`,
							communityId: communityId,
							schemaName: info.schemaName,
							isRelation: info.relation,
						}
					})
				)
				.returning(["id", "slug", "name", "schemaName", "isRelation"])
				.execute()
		: []

	const pubFieldsByName = Object.fromEntries(
		createdPubFields.map((pubField) => [
			pubFieldsList.find(([name]) => name === pubField.name)?.[0],
			pubField,
		])
	) as PubFieldsByName<PF>

	const pubTypesList = Object.entries(props.pubTypes ?? {}).map(
		([pubTypeName, fieldsOrMoreInfo]) => {
			if ("id" in fieldsOrMoreInfo) {
				return {
					name: pubTypeName,
					communityId: communityId,
					id: fieldsOrMoreInfo.id as PubTypesId,
					fields: fieldsOrMoreInfo.fields as Partial<
						Record<keyof PF, { isTitle: boolean }>
					>,
				}
			}
			return {
				name: pubTypeName,
				communityId: communityId,
				id: undefined,
				fields: fieldsOrMoreInfo,
			}
		}
	)
	const createdPubTypes = pubTypesList.length
		? await trx
				.insertInto("pub_types")
				.values(
					pubTypesList.map(({ name, communityId, id }) => ({
						name,
						communityId: communityId,
						id,
					}))
				)
				.returningAll()
				.execute()
		: []

	const createdPubFieldToPubTypes =
		pubTypesList.length && pubFieldsList.length
			? await trx
					.insertInto("_PubFieldToPubType")
					.values(
						pubTypesList.flatMap(({ name, id, fields }) => {
							const ranks = findRanksBetween({
								numberOfRanks: Object.keys(fields).length,
							})

							return Object.entries(fields).flatMap(([field, meta], fieldIdx) => {
								const isTitle = meta?.isTitle ?? false
								const fieldId = createdPubFields.find(
									(createdField) => createdField.name === field
								)?.id
								const pubTypeId =
									id ??
									createdPubTypes.find((pubType) => pubType.name === name)?.id
								if (!pubTypeId || !fieldId) {
									return []
								}

								return [
									{
										A: fieldId,
										B: pubTypeId,
										isTitle,
										rank: ranks[fieldIdx],
									},
								]
							})
						})
					)
					.returningAll()
					.execute()
			: []

	const pubTypesWithPubFieldsByName = Object.fromEntries(
		createdPubTypes.map((pubType) => [
			pubType.name,
			{
				...pubType,
				fields: Object.fromEntries(
					createdPubFieldToPubTypes
						.filter((pubFieldToPubType) => pubFieldToPubType.B === pubType.id)
						.map((pubFieldToPubType) => {
							const pubField = createdPubFields.find(
								(pubField) => pubField.id === pubFieldToPubType.A
							)!

							return [
								pubField.name,
								{
									...pubField,
									isTitle: pubFieldToPubType.isTitle,
									rank: pubFieldToPubType.rank,
								},
							] as const
						})
				),
				defaultForm: {
					slug: `${slugifyString(pubType.name)}-default-editor`,
				},
			},
		])
	) as PubTypesByName<PT, PF>

	// separate new users from existing user references
	const newUsers = Object.entries(props.users ?? {}).filter(
		(user): user is [string, (typeof user)[1] & { existing?: false }] => !user[1].existing
	)

	const existingUserRefs = Object.entries(props.users ?? {}).filter(
		(user): user is [string, (typeof user)[1] & { existing: true }] => !!user[1].existing
	)

	// create new users using addUser
	const newUserValues = await Promise.all(
		newUsers.map(async ([slug, userInfo]) => ({
			id: userInfo.id ?? (crypto.randomUUID() as UsersId),
			slug:
				options?.randomSlug === false
					? (userInfo.slug ?? slug)
					: `${userInfo.slug ?? slug}${randomSlugSuffix}`,
			email: userInfo.email ?? faker.internet.email(),
			firstName: userInfo.firstName ?? faker.person.firstName(),
			lastName: userInfo.lastName ?? faker.person.lastName(),
			avatar: userInfo.avatar ?? faker.image.avatar(),
			passwordHash: await createPasswordHash(userInfo.password ?? faker.internet.password()),
			isSuperAdmin: userInfo.isSuperAdmin ?? false,
			isVerified: userInfo.isVerified !== false,
		}))
	)

	const createdUsers: Users[] = []
	for (const userValue of newUserValues) {
		const user = await addUser(userValue, trx).executeTakeFirstOrThrow()
		// addUser returns SafeUser without passwordHash, but we need the full Users type
		createdUsers.push({ ...user, passwordHash: userValue.passwordHash })
	}

	// resolve existing user references by id, slug, or email
	const resolvedExistingUsers: Array<[string, Users & { role?: MemberRole | null }]> = []
	for (const [key, userRef] of existingUserRefs) {
		let existingUser: Users | undefined

		if ("id" in userRef && userRef.id) {
			existingUser = await trx
				.selectFrom("users")
				.selectAll()
				.where("id", "=", userRef.id)
				.executeTakeFirst()
		} else if ("slug" in userRef && userRef.slug) {
			existingUser = await trx
				.selectFrom("users")
				.selectAll()
				.where("slug", "=", userRef.slug)
				.executeTakeFirst()
		} else if ("email" in userRef && userRef.email) {
			existingUser = await trx
				.selectFrom("users")
				.selectAll()
				.where("email", "=", userRef.email)
				.executeTakeFirst()
		}

		if (!existingUser) {
			throw new Error(
				`Could not find existing user referenced by ${JSON.stringify(userRef)}`
			)
		}

		resolvedExistingUsers.push([key, { ...existingUser, role: userRef.role }])
	}

	// combine new and existing users
	const usersBySlug = Object.fromEntries([
		...newUsers.map(([slug], idx) => [slug, { ...newUsers[idx][1], ...createdUsers[idx] }]),
		...resolvedExistingUsers,
	]) as UsersBySlug<U>

	// create community memberships for users with roles
	const possibleMembers = Object.entries(usersBySlug)
		.filter(([, userInfo]) => !!userInfo.role)
		.map(([, userWithRole]) => ({
			userId: userWithRole.id,
			communityId,
			role: userWithRole.role!,
			forms: [] as FormsId[],
		}))

	const createdMembers: CommunityMemberships[] = []
	for (const memberData of possibleMembers) {
		const members = await insertCommunityMemberships(memberData, trx).execute()
		createdMembers.push(...members)
	}

	const usersWithMemberShips = Object.fromEntries(
		Object.entries(usersBySlug)
			.filter(([, user]) => !!user.role)
			.map(([slug, user], idx) => [
				slug,
				{
					...user,
					member: createdMembers[idx],
				},
			])
	) as { [K in keyof U]: UsersBySlug<U>[K] & { member: CommunityMemberships } }

	const stageList = Object.entries(props.stages ?? {})

	// create stages using createStage
	const createdStages: Stages[] = []
	for (let idx = 0; idx < stageList.length; idx++) {
		const [stageName, stageInfo] = stageList[idx]
		const stage = await createStage(
			{
				id: stageInfo.id,
				communityId,
				name: stageName,
				order: `${(idx + 10).toString(36)}${(idx + 10).toString(36)}`,
			},
			trx
		).executeTakeFirstOrThrow()
		createdStages.push(stage)
	}

	const consolidatedStages = createdStages.map((stage, idx) => ({
		...stageList[idx][1],
		...stage,
	}))
	//

	// create stage memberships using insertStageMemberships
	const stageMembers = consolidatedStages
		.flatMap((stage) => {
			if (!stage.members) return []

			return Object.entries(stage.members)?.map(([member, role]) => ({
				stage,
				user: usersWithMemberShips[member as string],
				role,
			}))
		})
		.filter(
			(stageMember) =>
				stageMember.user?.member !== undefined && stageMember.role !== undefined
		)

	const stageMemberships = []
	for (const stageMember of stageMembers) {
		const result = await insertStageMemberships(
			{
				role: stageMember.role!,
				stageId: stageMember.stage.id,
				userId: stageMember.user.id,
				forms: [] as FormsId[],
			},
			trx
		).execute()
		stageMemberships.push(...result)
	}

	// create stage connections using createMoveConstraint
	const stageConnectionsList = []
	if (props.stageConnections) {
		for (const [stage, destinations] of Object.entries(props.stageConnections)) {
			if (!destinations) continue

			const currentStageId = consolidatedStages.find(
				(consolidatedStage) => consolidatedStage.name === stage
			)?.id

			if (!currentStageId) {
				throw new Error(
					`Something went wrong during the creation of stage connections. Stage ${stage} not found in the output of the created stages.`
				)
			}

			const { to, from } = destinations

			// create "to" connections
			for (const dest of to ?? []) {
				const toStage = consolidatedStages.find((s) => s.name === dest)
				if (!toStage) {
					throw new Error(
						`Something went wrong during the creation of stage connections. Stage ${String(dest)} not found in the output of the created stages.`
					)
				}
				const constraint = await createMoveConstraint(
					{
						stageId: currentStageId,
						destinationId: toStage.id,
					},
					trx
				).executeTakeFirstOrThrow()
				stageConnectionsList.push(constraint)
			}

			// create "from" connections
			for (const dest of from ?? []) {
				const fromStage = consolidatedStages.find((s) => s.name === dest)
				if (!fromStage) {
					throw new Error(
						`Something went wrong during the creation of stage connections. Stage ${String(dest)} not found in the output of the created stages.`
					)
				}
				const constraint = await createMoveConstraint(
					{
						stageId: fromStage.id,
						destinationId: currentStageId,
					},
					trx
				).executeTakeFirstOrThrow()
				stageConnectionsList.push(constraint)
			}
		}
	}

	const createPubRecursiveInput = props.pubs
		? makePubInitializerMatchCreatePubRecursiveInput({
				pubTypes: createdPubTypes,
				users: createdUsers,
				stages: createdStages,
				community: createdCommunity,
				pubs: props.pubs,
				trx,
			})
		: []

	// TODO: this can be simplified a lot by first creating the pub
	// and then creating their related pubs

	let createdPubs: ProcessedPub[] = []

	logger.info(
		`${createdCommunity.name}: ${options?.parallelPubs ? "Parallelly" : "Sequentially"} - Creating ${createPubRecursiveInput.length} pubs`
	)
	if (options?.parallelPubs) {
		const input = createPubRecursiveInput.map((input) => createPubRecursiveNew({ ...input }))

		setInterval(() => {
			logger.info(`${createdCommunity.name}: Creating Pubs...`)
		}, 1000)

		createdPubs = await Promise.all(input)
	} else {
		// we do this one at a time because we allow pubs to be able to reference each other in the relatedPubs field
		for (const input of createPubRecursiveInput) {
			const pub = await createPubRecursiveNew(input)
			createdPubs.push(pub)
		}
	}

	logger.info(`${createdCommunity.name}: Successfully created pubs`)

	const formList = props.forms ? Object.entries(props.forms) : []
	const formElementsWithRelatedPubTypes = formList.flatMap(([formTitle, formInput]) =>
		formInput.elements
			.filter((elementInput) => elementInput.relatedPubTypes?.length)
			.map((elementInput) => ({
				...elementInput,
				formTitle,
			}))
	)

	console.log("formList", formList)
	const createdForms =
		formList.length > 0
			? await trx
					.with("form", (eb) =>
						eb
							.insertInto("forms")
							.values(
								formList.map(([formTitle, formInput]) => {
									const pubType = createdPubTypes.find(
										(pubType) => pubType.name === formInput.pubType
									)
									if (!pubType) {
										throw new Error(
											`Something went wrong during the creation of forms. Pub type ${String(formInput.pubType)} not found in the output of the created pub types.`
										)
									}
									return {
										id: formInput.id,
										access: formInput.access,
										isArchived: formInput.isArchived,
										name: formTitle,
										slug: formInput.slug ?? slugifyString(formTitle),
										communityId: communityId,
										pubTypeId: pubType.id,
										isDefault: formInput.isDefault,
									}
								})
							)
							.returningAll()
					)
					.with("form-elements", (db) =>
						db
							.insertInto("form_elements")
							.values((eb) =>
								formList.flatMap(([formTitle, formInput]) => {
									const ranks = findRanksBetween({
										numberOfRanks: formInput.elements.length,
									})
									return formInput.elements.map((elementInput, elementIndex) => ({
										formId: eb
											.selectFrom("form")
											.select("form.id")
											.limit(1)
											.where(
												"form.slug",
												"=",
												formInput.slug ?? slugifyString(formTitle)
											),
										type: elementInput.type,
										fieldId: createdPubFields.find(
											(pubField) => pubField.name === elementInput.field
										)?.id,
										content: elementInput.content,
										label: elementInput.label,
										element: elementInput.element,
										component: elementInput.component,
										rank: ranks[elementIndex],
										config: elementInput.config,
									}))
								})
							)
							.returningAll()
					)

					.selectFrom("form")
					.selectAll("form")
					.select((eb) =>
						jsonArrayFrom(
							eb
								.selectFrom("form-elements")
								.selectAll("form-elements")
								.whereRef("form-elements.formId", "=", "form.id")
						).as("elements")
					)
					.execute()
			: []

	// check if we don't end up creating duplicate forms (mostly relevant when importing a template)

	const toBeInsertedDefaultForms = Object.values(pubTypesWithPubFieldsByName).filter(
		(pubType) =>
			!createdForms.some(
				(form) =>
					form.pubTypeId === pubType.id &&
					(form.isDefault || form.name === `${pubType.name} Editor (Default)`)
			)
	)

	await Promise.all(
		toBeInsertedDefaultForms.map((pubType) =>
			insertForm(
				{ ...pubType, fields: Object.values(pubType.fields) },
				`${pubType.name} Editor (Default)`,
				pubType.defaultForm.slug,
				communityId,
				true,
				trx
			).executeTakeFirst()
		)
	)

	if (createdForms.length && formElementsWithRelatedPubTypes.length) {
		const feee = createdForms.flatMap((form) =>
			form.elements.flatMap((fe, feIdx) => {
				const formInput = props.forms?.[form.name]
				if (!formInput) return []

				const formElementInput = formInput.elements[feIdx]
				if (!formElementInput) return []

				if (!formElementInput.relatedPubTypes || !formElementInput.relatedPubTypes.length)
					return []

				return formElementInput.relatedPubTypes.map((relatedPubType) => {
					const pubType = createdPubTypes.find(
						(pubType) => pubType.name === relatedPubType
					)

					if (!pubType) throw new Error(`Pub type ${String(relatedPubType)} not found`)

					return {
						A: fe.id,
						B: pubType.id,
					}
				})
			})
		)

		if (feee.length) {
			await trx.insertInto("_FormElementToPubType").values(feee).execute()
		}
	}

	// form members
	const toBeCreatedFormMembers = formList.flatMap(([formTitle, formInput]) => {
		if (!formInput.members) return []
		return formInput.members.map((member) => ({
			formId: createdForms.find((form) => form.name === formTitle)?.id,
			userId: usersWithMemberShips[member].id,
			role: usersWithMemberShips[member].role ?? MemberRole.contributor,
			communityId: communityId,
		}))
	})

	if (toBeCreatedFormMembers.length) {
	}

	const formsByName = Object.fromEntries(
		createdForms.map((form) => [form.name, form])
	) as unknown as FormsByName<F>

	const { upsertAutomation } = await import("~/lib/server/automations")

	const initialCreatedAutomations: Automations[] = []
	for (const stage of consolidatedStages) {
		if (!stage.automations) {
			continue
		}

		const automations = Object.entries(stage.automations).map(
			([automationName, automation]) => {
				return {
					name: automationName,
					id: crypto.randomUUID() as AutomationsId,
					...automation,
					actions: automation.actions.map((action) => ({
						id: crypto.randomUUID() as ActionInstancesId,
						...action,
					})),
				}
			}
		)

		// this is really silly, but since some automations can be referential it makes sense to run them twice to make sure the reference is valid
		const automationsTwice = [...automations, ...automations]
		for (const automation of automationsTwice) {
			const createdAutomation = await upsertAutomation(
				{
					id: automation.id,
					name: automation.name,
					communityId: communityId,
					actionInstances: automation.actions.map((action) => ({
						id: action.id,
						config: action.config,
						action: action.action,
					})),
					conditionEvaluationTiming: automation.timing,
					stageId: stage.id,
					icon: automation.icon,
					triggers: automation.triggers.map((trigger) => {
						const sourceAutomation = trigger.sourceAutomation
							? initialCreatedAutomations.findLast(
									(automation) => automation.name === trigger.sourceAutomation
								)
							: undefined

						return {
							event: trigger.event,
							config: trigger.config,
							sourceAutomationId: sourceAutomation?.id,
						}
					}),
					condition: automation.condition
						? {
								// this cast is just to set the rank type, it's annoying to have to specify the rank manually in the seed
								...(automation.condition as ConditionBlockFormValue),
								kind: "block" as const,
								rank: "a", // get's auto gend
							}
						: undefined,
					resolver: automation.resolver,
				},
				trx
			)
			initialCreatedAutomations.push(createdAutomation)
		}
	}

	const createdAutomations = initialCreatedAutomations.length
		? await getAutomationBase()
				.where(
					"automations.id",
					"in",
					initialCreatedAutomations.map((automation) => automation.id)
				)
				.execute()
		: []

	logger.info(
		`${createdCommunity.name}: Successfully created ${createdAutomations.length} automations`
	)

	const fullStages = Object.fromEntries(
		consolidatedStages.map((stage) => {
			const automationsForStage = createdAutomations.filter(
				(automation) => automation.stageId === stage.id
			)
			return [
				stage.name,
				{
					...stage,
					automations: Object.fromEntries(
						automationsForStage.map((automation) => [automation.name, automation])
					),
				},
			]
		})
	) as unknown as StagesWithPermissionsAndActionsAndAutomationsByName<
		U,
		S,
		typeof stageMemberships
	>

	const apiTokens = Object.entries(props.apiTokens ?? {})
	const createdApiTokens = Object.fromEntries(
		await Promise.all([
			["site-builder", await createSiteBuilderToken(communityId, trx)],
			...apiTokens.map(async ([tokenName, tokenInput]) => {
				const [tokenId, tokenString] = tokenInput.id?.split(".") ?? [crypto.randomUUID()]

				const issuedById = createdMembers.find(
					(member) => member.role === MemberRole.admin
				)?.userId

				if (!issuedById) {
					throw new Error(
						"Attempting to create an API token without an admin member. You should create an admin member in the seed if you intend to be able to use the API."
					)
				}

				const { token } = await createApiAccessToken(
					{
						token: {
							name: tokenName,
							communityId,
							expiration: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30 * 12),
							description: tokenInput.description,
							issuedAt: new Date(),
							id: tokenId as ApiAccessTokensId,
							issuedById,
							...(tokenString ? { token: tokenString } : {}),
						},
						permissions:
							tokenInput.permissions === true || tokenInput.permissions === undefined
								? allPermissions
								: Object.entries(tokenInput.permissions).flatMap(
										([scope, accessType]) =>
											Object.entries(accessType).flatMap(
												([accessType, constraints]) => ({
													scope: scope as ApiAccessScope,
													accessType: accessType as ApiAccessType,
													constraints:
														constraints as ApiAccessPermissionConstraints,
												})
											)
									),
					},
					trx
				).executeTakeFirstOrThrow()

				logger.info(`${createdCommunity.name}: Successfully created API token ${tokenName}`)

				return [tokenName, token]
			}),
		])
	) as {
		[TokenName in keyof NonNullable<AI> | "site-builder"]: string
	}

	const createdInvites = Object.fromEntries(
		await Promise.all(
			Object.entries(props.invites ?? {}).map(async ([inviteName, inviteInput]) => {
				const {
					token: rawToken,
					pubFormSlugs,
					stageFormSlugs,
					communityFormSlugs,
					...rest
				} = inviteInput

				let token: string
				let id: InvitesId
				if (rawToken) {
					const res = InviteService.parseInviteToken(rawToken)
					token = res.token
					id = res.id
				} else {
					id = crypto.randomUUID() as InvitesId
					token = generateToken()
				}

				const pFormSlugs = pubFormSlugs
					? pubFormSlugs.map((slug) => {
							const form = formsByName[slug]
							if (!form) {
								throw new Error(`Form ${slug as string} not found`)
							}
							return form.slug
						})
					: undefined

				const sFormSlugs = stageFormSlugs
					? stageFormSlugs.map((slug) => {
							const form = formsByName[slug]
							if (!form) {
								throw new Error(`Form ${slug as string} not found`)
							}
							return form.slug
						})
					: undefined

				const cfSlugs = communityFormSlugs
					? communityFormSlugs.map((slug) => {
							const form = formsByName[slug]
							if (!form) {
								throw new Error(`Form ${slug as string} not found`)
							}
							return form.slug
						})
					: undefined

				const rawInput = {
					id,
					token,
					communityId,
					lastModifiedBy: createLastModifiedBy("system"),
					pubFormSlugs: pFormSlugs ?? null,
					stageFormSlugs: sFormSlugs ?? null,
					communityFormSlugs: cfSlugs ?? null,
					invitedByUserId: inviteInput.invitedByActionRunId
						? null
						: expect(
								createdMembers.find((member) => member.role === MemberRole.admin)
									?.userId,
								"You need to create an admin member in the seed if you dont want to set the invitee manually."
							),
					...rest,
				}

				const input = newInviteSchema.parse(rawInput)

				const invite = await InviteService._createInvite(input, trx)

				return [
					inviteName,
					{ ...invite, inviteToken: InviteService.createInviteToken(invite) },
				]
			})
		)
	) as InvitesByName<II>

	logger.info(`${createdCommunity.name}: Successfully seeded community`)

	return {
		community: createdCommunity,
		pubFields: pubFieldsByName,
		pubTypes: pubTypesWithPubFieldsByName,
		users: usersBySlug,
		members: createdMembers,
		stages: fullStages,
		stageConnections: stageConnectionsList,
		pubs: createdPubs,
		automations: Object.fromEntries(
			createdAutomations.map((automation) => [automation.name, automation])
		),
		forms: formsByName,
		apiTokens: createdApiTokens,
		invites: createdInvites,
	}
}
