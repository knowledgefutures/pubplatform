import type { CommunitiesId, CommunityMembershipsId, PubsId, PubTypesId, StagesId } from "db/public"
import type { ExpressionBuilder, ExpressionWrapper } from "kysely"

import { createNextHandler } from "@ts-rest/serverless/next"

import { interpolate } from "@pubpub/json-interpolate"
import { siteApi, TOTAL_PUBS_COUNT_HEADER } from "contracts"
import {
	ApiAccessScope,
	ApiAccessType,
	AutomationEvent,
	Capabilities,
	ElementType,
	InputComponent,
	MembershipType,
} from "db/public"
import { logger } from "logger"

import { buildInterpolationContext } from "~/actions/_lib/interpolationContext"
import { runAutomation } from "~/actions/_lib/runAutomation"
import {
	checkAuthorization,
	getAuthorization,
	parseQueryWithQsMiddleware,
	shouldReturnRepresentation,
} from "~/lib/authentication/api"
import { userHasAccessToForm } from "~/lib/authorization/capabilities"
import { getAutomationsByTriggerConfig, getStage } from "~/lib/db/queries"
import { env } from "~/lib/env/env"
import {
	BadRequestError,
	createPubRecursiveNew,
	deletePub,
	doesPubExist,
	ForbiddenError,
	fullTextSearch,
	getPubsCount,
	getPubsWithRelatedValues,
	getPubType,
	getPubTypesForCommunity,
	NotFoundError,
	removeAllPubRelationsBySlugs,
	removePubRelations,
	replacePubRelationsBySlug,
	tsRestHandleErrors,
	updatePub,
	upsertPubRelations,
} from "~/lib/server"
import { findCommunityBySlug } from "~/lib/server/community"
import { getForm, getFormsForCommunity } from "~/lib/server/form"
import { applyJsonataFilter, compileJsonataQuery } from "~/lib/server/jsonata-query"
import { validateFilter } from "~/lib/server/pub-filters-validate"
import { getStages } from "~/lib/server/stages"
import { getMember, getSuggestedUsers } from "~/lib/server/user"

const handler = createNextHandler(
	siteApi,
	{
		auth: {
			check: {
				siteBuilder: async () => {
					const { isSiteBuilderToken } = await getAuthorization()

					if (!isSiteBuilderToken) {
						return {
							status: 401,
							body: {
								ok: false,
								code: "NON_SITE_BUILDER_TOKEN",
								reason: "The supplied token is not a site builder token. Either something went wrong with the token generation or the token was intercepted by a third party.",
							},
						}
					}

					// TODO: enable again when you're less silly
					// for (const permission of allPermissions) {
					// 	const exists = authorization[permission.scope]?.[permission.accessType];
					// 	if (permission.accessType !== "read" && exists) {
					// 		return {
					// 			status: 401,
					// 			body: {
					// 				ok: false,
					// 				code: "HAS_WRITE_PERMISSIONS",
					// 				reason: `Site builder token has ${permission.accessType} permissions for ${permission.scope}, which is not allowed. Please contact support.`,
					// 			},
					// 		};
					// 	}
					// 	if (permission.accessType === "read" && !exists) {
					// 		return {
					// 			status: 401,
					// 			body: {
					// 				ok: false,
					// 				code: "HAS_NO_READ_PERMISSIONS",
					// 				reason: `Site builder token has no read permissions for ${permission.scope}, which is required. Please contact support.`,
					// 			},
					// 		};
					// 	}
					// }

					return {
						status: 200,
						body: { ok: true },
					}
				},
			},
		},
		pubs: {
			search: async ({ query }) => {
				const { user, community } = await checkAuthorization({
					token: { scope: ApiAccessScope.pub, type: ApiAccessType.read },
					cookies: true,
				})

				const pubs = await fullTextSearch(query.query, community.id, user.id)

				return {
					status: 200,
					body: pubs,
				}
			},

			get: async ({ params, query }) => {
				const { user, community, authorization } = await checkAuthorization({
					token: { scope: ApiAccessScope.pub, type: ApiAccessType.read },
					cookies: {
						capability: Capabilities.viewPub,
						target: { type: MembershipType.pub, pubId: params.pubId as PubsId },
					},
				})

				const pub = await getPubsWithRelatedValues(
					{
						pubId: params.pubId as PubsId,
						communityId: community.id,
						userId: user.id,
					},
					query
				)

				if (typeof authorization === "object") {
					const allowedStages = authorization.stages
					if (
						pub.stageId &&
						allowedStages &&
						allowedStages.length > 0 &&
						!allowedStages.includes(pub.stageId)
					) {
						throw new ForbiddenError(
							`You are not authorized to view this pub in stage ${pub.stageId}`
						)
					}

					const allowedPubTypes = authorization.pubTypes
					if (
						allowedPubTypes &&
						allowedPubTypes.length > 0 &&
						!allowedPubTypes.includes(pub.pubTypeId)
					) {
						throw new ForbiddenError(
							`You are not authorized to view this pub in pub type ${pub.pubTypeId}`
						)
					}
				}

				return {
					status: 200,
					body: pub,
				}
			},
			getMany: async ({ query }, { responseHeaders }) => {
				const { user, community, authorization } = await checkAuthorization({
					token: { scope: ApiAccessScope.pub, type: ApiAccessType.read },
					cookies: "community-member",
				})

				const allowedPubTypes =
					typeof authorization === "object" ? authorization.pubTypes : undefined
				const allowedStages =
					typeof authorization === "object" ? authorization.stages : undefined

				const { pubTypeId, stageId, pubIds, filters, ...rest } = query ?? {}

				if (query?.filters) {
					try {
						await validateFilter(community.id, query.filters)
					} catch (e) {
						throw new BadRequestError(e.message)
					}
				}

				let customFilter:
					| ((eb: ExpressionBuilder<any, any>) => ExpressionWrapper<any, any, any>)
					| undefined
				if (query?.query) {
					const jsonataQuery = compileJsonataQuery(query.query)
					customFilter = (eb) =>
						applyJsonataFilter(eb, jsonataQuery, { communitySlug: community.slug })
				}

				const [pubs, pubCount] = await Promise.all([
					getPubsWithRelatedValues(
						{
							communityId: community.id,
							pubTypeId: pubTypeId,
							stageId: stageId,
							pubIds: pubIds,
							// TODO: make sure User is nullable, you don't get that with api key
							userId: user?.id,
						},
						{
							...rest,
							filters: query?.filters,
							customFilter,
							allowedPubTypes,
							allowedStages,
							...(query?.transform
								? {
										withValues: true,
										withRelatedPubs: true,
										depth: 3,
									}
								: {}),
						}
					),
					getPubsCount({
						communityId: community.id,
						pubTypeId: pubTypeId,
						stageId: stageId,
					}),
				])

				let finalPubs = pubs
				if (query?.transform) {
					try {
						finalPubs = await Promise.all(
							finalPubs.map(async (pub) => {
								const pubContext = buildInterpolationContext({
									community,
									pub,
									env: { PUBSTAR_URL: env.PUBSTAR_URL },
									useDummyValues: true,
								})

								const transformed = await interpolate(query.transform!, pubContext)

								const { values, ...pubWithoutValues } = pub

								return {
									...pubWithoutValues,
									content: transformed,
								}
							}) as any[]
						)
					} catch (error) {
						logger.error("Error transforming pubs", error)
						throw new BadRequestError("Error transforming pubs. " + error.message)
					}
				}

				// TODO: this does not account for permissions
				responseHeaders.set(TOTAL_PUBS_COUNT_HEADER, `${pubCount}`)

				return {
					status: 200,
					body: finalPubs,
				}
			},
			create: async ({ body }) => {
				const { authorization, community, lastModifiedBy } = await checkAuthorization({
					token: { scope: ApiAccessScope.pub, type: ApiAccessType.write },
					// TODO: refactor so we call userCanCreatePub here
					cookies: false,
				})

				if (
					authorization &&
					authorization !== true &&
					!authorization.stages.includes(body.stageId as StagesId)
				) {
					throw new ForbiddenError(
						`You are not authorized to create a pub in stage ${body.stageId}`
					)
				}

				const createdPub = await createPubRecursiveNew({
					communityId: community?.id,
					body,
					lastModifiedBy,
				})

				const returnRepresentation = shouldReturnRepresentation()

				if (!returnRepresentation) {
					return {
						status: 204,
					}
				}

				return {
					status: 201,
					body: createdPub,
				}
			},
			update: async ({ params, body }) => {
				const { user, community, lastModifiedBy } = await checkAuthorization({
					token: { scope: ApiAccessScope.pub, type: ApiAccessType.write },
					// TODO: refactor so we call userCanEditPub here
					cookies: false,
				})

				const { exists } = await doesPubExist(
					params.pubId as PubsId,
					community.id as CommunitiesId
				)

				if (!exists) {
					throw new NotFoundError(`Pub ${params.pubId} not found`)
				}

				await updatePub({
					pubValues: body,
					pubId: params.pubId as PubsId,
					communityId: community.id,
					continueOnValidationError: false,
					lastModifiedBy,
				})

				const returnRepresentation = shouldReturnRepresentation()

				if (!returnRepresentation) {
					return {
						status: 204,
					}
				}

				const pub = await getPubsWithRelatedValues({
					pubId: params.pubId as PubsId,
					communityId: community.id,
					userId: user.id,
				})

				return {
					status: 200,
					body: pub,
				}
			},
			archive: async ({ params }) => {
				const { lastModifiedBy, community } = await checkAuthorization({
					token: { scope: ApiAccessScope.pub, type: ApiAccessType.write },
					cookies: {
						capability: Capabilities.deletePub,
						target: { type: MembershipType.pub, pubId: params.pubId as PubsId },
					},
				})

				const result = await deletePub({
					pubId: params.pubId as PubsId,
					communityId: community.id,
					lastModifiedBy,
				})

				if (result?.numDeletedRows !== BigInt(1)) {
					return {
						status: 404,
						body: "Pub not found",
					}
				}

				return {
					status: 204,
				}
			},
			relations: {
				remove: async ({ params, body }) => {
					const { user, community, lastModifiedBy } = await checkAuthorization({
						token: { scope: ApiAccessScope.pub, type: ApiAccessType.write },
						cookies: {
							capability: Capabilities.deletePub,
							target: { type: MembershipType.pub, pubId: params.pubId as PubsId },
						},
					})

					const { exists } = await doesPubExist(
						params.pubId as PubsId,
						community.id as CommunitiesId
					)

					if (!exists) {
						throw new NotFoundError(`Pub ${params.pubId} not found`)
					}

					const { all, some } = Object.entries(body).reduce(
						(acc, [fieldSlug, pubIds]) => {
							if (pubIds === "*") {
								acc.all.push(fieldSlug)
							} else {
								acc.some.push(
									...pubIds.map((relatedPubId) => ({
										slug: fieldSlug,
										relatedPubId,
									}))
								)
							}
							return acc
						},
						{
							all: [] as string[],
							some: [] as { slug: string; relatedPubId: PubsId }[],
						}
					)

					const [removedAllSettled, removedSomeSettled] = await Promise.allSettled([
						removeAllPubRelationsBySlugs({
							pubId: params.pubId as PubsId,
							slugs: all,
							communityId: community.id,
							lastModifiedBy,
						}),
						removePubRelations({
							pubId: params.pubId as PubsId,
							relations: some,
							communityId: community.id,
							lastModifiedBy,
						}),
					])

					if (
						removedAllSettled.status === "rejected" ||
						removedSomeSettled.status === "rejected"
					) {
						return {
							status: 400,
							body: `Failed to remove pub relations: ${
								removedAllSettled.status === "rejected"
									? removedAllSettled.reason
									: removedSomeSettled.status === "rejected"
										? removedSomeSettled.reason
										: ""
							}`,
						}
					}

					const returnRepresentation = shouldReturnRepresentation()

					if (!returnRepresentation) {
						return {
							status: 204,
						}
					}

					const pub = await getPubsWithRelatedValues({
						pubId: params.pubId as PubsId,
						communityId: community.id,
						userId: user.id,
					})

					return {
						status: 200,
						body: pub,
					}
				},
				update: async ({ params, body }) => {
					const { user, community, lastModifiedBy } = await checkAuthorization({
						token: { scope: ApiAccessScope.pub, type: ApiAccessType.write },
						cookies: {
							capability: Capabilities.deletePub,
							target: { type: MembershipType.pub, pubId: params.pubId as PubsId },
						},
					})

					const { exists } = await doesPubExist(
						params.pubId as PubsId,
						community.id as CommunitiesId
					)

					if (!exists) {
						throw new NotFoundError(`Pub ${params.pubId} not found`)
					}

					const relations = Object.entries(body).flatMap(([slug, data]) =>
						data.map((idOrPubInitPayload) => ({ slug, ...idOrPubInitPayload }))
					)

					await upsertPubRelations({
						pubId: params.pubId as PubsId,
						relations,
						communityId: community.id,
						lastModifiedBy,
					})

					const returnRepresentation = shouldReturnRepresentation()

					if (!returnRepresentation) {
						return {
							status: 204,
						}
					}

					const pub = await getPubsWithRelatedValues({
						pubId: params.pubId as PubsId,
						communityId: community.id,
						userId: user.id,
					})

					return {
						status: 200,
						body: pub,
					}
				},
				replace: async ({ params, body }) => {
					const { user, community, lastModifiedBy } = await checkAuthorization({
						token: { scope: ApiAccessScope.pub, type: ApiAccessType.write },
						cookies: {
							capability: Capabilities.deletePub,
							target: { type: MembershipType.pub, pubId: params.pubId as PubsId },
						},
					})

					const { exists } = await doesPubExist(
						params.pubId as PubsId,
						community.id as CommunitiesId
					)

					if (!exists) {
						throw new NotFoundError(`Pub ${params.pubId} not found`)
					}
					const relations = Object.entries(body).flatMap(([slug, data]) =>
						data.map((idOrPubInitPayload) => ({ slug, ...idOrPubInitPayload }))
					)

					await replacePubRelationsBySlug({
						pubId: params.pubId as PubsId,
						relations,
						communityId: community.id,
						lastModifiedBy,
					})

					const returnRepresentation = shouldReturnRepresentation()

					if (!returnRepresentation) {
						return {
							status: 204,
						}
					}

					const pub = await getPubsWithRelatedValues({
						pubId: params.pubId as PubsId,
						communityId: community.id,
						userId: user.id,
					})

					return {
						status: 200,
						body: pub,
					}
				},
			},
		},
		pubTypes: {
			get: async (req) => {
				const { community } = await checkAuthorization({
					token: { scope: ApiAccessScope.pubType, type: ApiAccessType.read },
					// TODO: figure out capability her
					cookies: false,
				})

				const pubType = await getPubType(
					req.params.pubTypeId as PubTypesId
				).executeTakeFirst()

				if (!pubType) {
					throw new NotFoundError(`No pub type found for id ${req.params.pubTypeId}`)
				}

				return {
					status: 200,
					body: pubType,
				}
			},
			getMany: async (req) => {
				const { community } = await checkAuthorization({
					token: { scope: ApiAccessScope.pubType, type: ApiAccessType.read },
					// TODO: figure out capability here
					cookies: false,
				})

				const pubTypes = await getPubTypesForCommunity(
					community.id as CommunitiesId,
					req.query
				)
				return {
					status: 200,
					body: pubTypes,
				}
			},
		},
		stages: {
			get: async (req) => {
				const { user } = await checkAuthorization({
					token: { scope: ApiAccessScope.stage, type: ApiAccessType.read },
					cookies: {
						capability: Capabilities.viewStage,
						target: {
							type: MembershipType.stage,
							stageId: req.params.stageId as StagesId,
						},
					},
				})
				const stage = await getStage(
					req.params.stageId as StagesId,
					user.id
				).executeTakeFirst()
				if (!stage) {
					throw new NotFoundError("No stage found")
				}

				return {
					status: 200,
					body: stage,
				}
			},
			getMany: async () => {
				const { community, user } = await checkAuthorization({
					token: { scope: ApiAccessScope.stage, type: ApiAccessType.read },
					cookies: false,
				})

				const stages = await getStages({
					communityId: community.id,
					userId: user.id,
				}).execute()
				return {
					status: 200,
					body: stages,
				}
			},
		},
		users: {
			search: async (req) => {
				const { community } = await checkAuthorization({
					token: { scope: ApiAccessScope.community, type: ApiAccessType.read },
					cookies: true,
				})

				const users = await getSuggestedUsers({
					communityId: req.query.communityId,
					query: {
						email: req.query.email,
						firstName: req.query.name,
						lastName: req.query.name,
					},
					limit: req.query.limit,
				}).execute()
				return {
					status: 200,
					body: users,
				}
			},
		},
		members: {
			get: async (req) => {
				const { community } = await checkAuthorization({
					token: { scope: ApiAccessScope.community, type: ApiAccessType.read },
					cookies: true,
				})
				const memberId = req.params.memberId as CommunityMembershipsId
				const user = await getMember(memberId).executeTakeFirst()
				if (!user) {
					throw new NotFoundError("No member found")
				}

				return {
					status: 200,
					body: user,
				}
			},
		},
		forms: {
			getForm: async ({ params }) => {
				const { user, community } = await checkAuthorization({
					token: { scope: ApiAccessScope.form, type: ApiAccessType.read },
					cookies: "community-member",
				})

				const [form, userCanAccessForm] = await Promise.all([
					getForm({
						slug: params.formSlug,
						communityId: community.id,
					}).executeTakeFirst(),
					userHasAccessToForm({
						userId: user.id,
						communityId: community.id,
						formSlug: params.formSlug,
					}),
				])

				if (!form) {
					throw new NotFoundError()
				}

				if (!userCanAccessForm) {
					throw new ForbiddenError()
				}

				return {
					status: 200,
					body: form,
				}
			},
			getForms: async () => {
				const { user, community } = await checkAuthorization({
					token: { scope: ApiAccessScope.form, type: ApiAccessType.read },
					cookies: "community-member",
				})

				const forms = await getFormsForCommunity(community.id).execute()

				return {
					status: 200,
					body: forms,
				}
			},
			getPubsForFormField: async ({ params, query }, { responseHeaders }) => {
				const { user, community } = await checkAuthorization({
					token: { scope: ApiAccessScope.pub, type: ApiAccessType.read },
					cookies: "community-member",
				})

				const { pubTypeId, stageId, pubIds, filters, currentPubId, ...rest } = query ?? {}

				if (query?.filters) {
					try {
						await validateFilter(community.id, query.filters)
					} catch (e) {
						throw new BadRequestError(e.message)
					}
				}

				const [form, userCanAccessForm] = await Promise.all([
					getForm({
						slug: params.formSlug,
						communityId: community.id,
					}).executeTakeFirst(),
					userHasAccessToForm({
						userId: user.id,
						communityId: community.id,
						formSlug: params.formSlug,
						pubId: currentPubId,
					}),
				])

				if (!form) {
					throw new NotFoundError()
				}

				if (!userCanAccessForm) {
					throw new ForbiddenError()
				}

				// check if user has access to the form
				const field = form.elements.find((e) => e.slug === params.fieldSlug)

				if (
					!field ||
					field.type !== ElementType.pubfield ||
					field.isRelation !== true ||
					field.config.relationshipConfig.component !== InputComponent.relationBlock
				) {
					throw new NotFoundError(
						`Field ${params.fieldSlug} not found on form ${params.formSlug}`
					)
				}

				const formFieldPubTypes = field.relatedPubTypes

				if (formFieldPubTypes.length === 0) {
					throw new BadRequestError(
						`Field ${params.fieldSlug} on form ${params.formSlug} does not allow any pub types`
					)
				}

				const [pubs, pubCount] = await Promise.all([
					getPubsWithRelatedValues(
						{
							communityId: community.id,
							pubTypeId: pubTypeId,
							stageId: stageId,
							pubIds: pubIds,
							// userId: user.id,
						},
						{
							...rest,
							filters: query?.filters,
							allowedPubTypes: formFieldPubTypes,
						}
					),
					getPubsCount({
						communityId: community.id,
						pubTypeId: pubTypeId,
						stageId: stageId,
					}),
				])

				// TODO: this does not account for permissions
				responseHeaders.set(TOTAL_PUBS_COUNT_HEADER, `${pubCount}`)

				return {
					status: 200,
					body: pubs,
				}
			},
		},
		webhook: async ({ params, body }) => {
			const community = await findCommunityBySlug()
			// const { community } = await checkAuthorization({
			// 	token: { scope: ApiAccessScope.community, type: ApiAccessType.read },
			// 	cookies: true,
			// });
			if (!community) {
				throw new NotFoundError(`Community not found`)
			}

			const path = params.path as string

			const automations = await getAutomationsByTriggerConfig("path", path, {
				event: AutomationEvent.webhook,
				communityId: community.id as CommunitiesId,
			})

			if (!automations || automations.length === 0) {
				throw new NotFoundError(`No webhoook automations found for path ${path}`)
			}

			if (!body) {
				throw new BadRequestError(
					"Body is required for webhook, send an empty one if needed"
				)
			}

			try {
				for (const automation of automations) {
					await runAutomation({
						automationId: automation.id,
						json: body,
						trigger: {
							event: AutomationEvent.webhook,
							config: automation.triggers.find(
								(t) => t.event === AutomationEvent.webhook
							)?.config as Record<string, unknown> | null,
						},
						manualActionInstancesOverrideArgs: null,
						communityId: community.id as CommunitiesId,
						stack: [],
						user: null,
					})
				}

				return {
					status: 201,
					body: undefined,
				}
			} catch (e) {
				logger.error(e)
				return {
					status: 500,
					body: `Something went wrong when triggering webhook. ${e.message}`,
				}
			}
		},
	},
	{
		handlerType: "app-router",
		jsonQuery: true,
		errorHandler: tsRestHandleErrors,
		cors: {
			origin: "*",
			allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
		},
		requestMiddleware: [parseQueryWithQsMiddleware],
	}
)

export {
	handler as DELETE,
	handler as GET,
	handler as OPTIONS,
	handler as PATCH,
	handler as POST,
	handler as PUT,
}
