import type { CommunitiesId, PubsId } from "db/public"

import { faker } from "@faker-js/faker"

import { CoreSchemaType, MemberRole } from "db/public"

import { db } from "~/kysely/database"
import { createLastModifiedBy } from "~/lib/lastModifiedBy"
import { seedCommunity } from "../seed/seedCommunity"
import { usersExisting } from "./users"

const abstract = `<p>The development of AAV capsids for therapeutic gene delivery has exploded in popularity over the past few years. <em>However</em>, humans aren’t the first or only species using viral capsids for gene delivery — wasps evolved this tactic over 100 million years ago. Parasitoid wasps that lay eggs inside arthropod hosts have co-opted ancient viruses for gene delivery to manipulate multiple aspects of the host’s biology, thereby increasing the probability of survival of the wasp larvae</p>`

export const seedLegacy = async (communityId?: CommunitiesId) => {
	const { poniesText } = await import("./ponies.snippet")

	const articleSeed = (number = 1_000, asRelation = false) =>
		Array.from({ length: number }, (_, idx) => {
			const pub = {
				pubType: "Journal Article",
				stage: "Articles",
				values: {
					Title: faker.lorem.sentence(),
					"Publication Date": new Date(Date.now() - idx * 1000 * 60 * 60 * 24),
					"Creation Date": new Date(Date.now() - idx * 1000 * 60 * 60 * 24),
					"Last Edited": new Date(Date.now() - idx * 1000 * 60 * 60 * 24),
					Avatar: faker.image.url(),
					Description: faker.lorem.paragraph(),
					Abstract: abstract,
					License: "CC-BY 4.0",
					Content: abstract,
					URL: "https://www.pubpub.org",
					"Inline Citation Style": "Author Year",
					"Citation Style": "APA 7",
				},
				relatedPubs: {
					// connections in Legacy
					Contributors: [
						{
							value: "Editing & Draft Preparation",
							pub: {
								pubType: "Author",
								values: {
									Name: faker.person.fullName(),
									ORCiD: "https://orcid.org/0000-0000-0000-0000",
									Affiliation: "University of Somewhere",
								},
							},
						},
					],
					Downloads: [
						{
							// acting as a description of the download
							value: "PDF Download",
							pub: {
								pubType: "PDF Download",
								// can't really add the actual file here
								values: {},
							},
						},
					],
					Tables: [
						{
							value: null,
							pub: {
								pubType: "Table",
								values: {
									Caption: "A beautiful table.",
									CSV: [],
								},
							},
						},
						{
							value: null,
							pub: {
								pubType: "Table",
								values: {
									Caption: "A glorious table.",
									CSV: [],
								},
							},
						},
					],
					Images: [
						{
							value: null,
							pub: {
								pubType: "Pub Image",
								values: {
									Caption: "A beautiful image.",
								},
							},
						},
					],
					Citations: [
						{
							value: "Chapter 5",
							pub: {
								pubType: "ExternalBook",
								values: {
									Title: "A Great Book",
									DOI: "10.82234/legacy-ad7f-7a6d",
									Year: "2022",
								},
							},
						},
						{
							value: "pp. 35-53",
							pub: {
								pubType: "ExternalJournalArticle",
								values: {
									Title: "A Great Journal Article",
									DOI: "10.82234/legacy-ad7f-7a6d",
									Year: "2022",
								},
							},
						},
					],
				},
			}

			if (!asRelation) {
				return pub
			}

			return {
				value: "",
				pub,
			}
		}) as any

	const articleId2 = crypto.randomUUID()
	const articleId = crypto.randomUUID()
	const authorId = crypto.randomUUID()

	const seed = await seedCommunity(
		{
			community: {
				id: communityId,
				slug: "legacy",
				name: "Legacy",
				avatar: "https://www.pubpub.org/static/logo.png",
			},
			pubFields: {
				Title: { schemaName: CoreSchemaType.String },
				Slug: { schemaName: CoreSchemaType.String },
				"Publication Date": { schemaName: CoreSchemaType.DateTime },
				"Creation Date": { schemaName: CoreSchemaType.DateTime },
				"Last Edited": { schemaName: CoreSchemaType.DateTime },
				// should be fileupload
				Avatar: { schemaName: CoreSchemaType.String },
				Description: { schemaName: CoreSchemaType.String },
				Abstract: { schemaName: CoreSchemaType.RichText },
				License: { schemaName: CoreSchemaType.String },
				Content: { schemaName: CoreSchemaType.RichText },
				DOI: { schemaName: CoreSchemaType.String },
				"DOI Suffix": { schemaName: CoreSchemaType.String },
				URL: { schemaName: CoreSchemaType.URL },
				"PDF Download Displayname": { schemaName: CoreSchemaType.String },
				PDF: { schemaName: CoreSchemaType.FileUpload },
				"Pub Image": { schemaName: CoreSchemaType.FileUpload },

				Color: { schemaName: CoreSchemaType.Color },
				Caption: { schemaName: CoreSchemaType.String },
				// a contributor is a relation to an Author
				Contributors: {
					// string here acts as a description of the contribution
					schemaName: CoreSchemaType.String,
					relation: true,
					//TODO: when we have typed relations, add pubType: Author here
				},
				Name: { schemaName: CoreSchemaType.String },
				ORCiD: { schemaName: CoreSchemaType.URL },
				Affiliation: { schemaName: CoreSchemaType.String },
				Year: { schemaName: CoreSchemaType.String },
				CSV: { schemaName: CoreSchemaType.FileUpload },
				Tag: { schemaName: CoreSchemaType.Null, relation: true },
				Editors: { schemaName: CoreSchemaType.Null, relation: true },

				MemberId: { schemaName: CoreSchemaType.String },

				Downloads: { schemaName: CoreSchemaType.String, relation: true },
				Images: { schemaName: CoreSchemaType.Null, relation: true },
				Tables: { schemaName: CoreSchemaType.Null, relation: true },
				Citations: { schemaName: CoreSchemaType.String, relation: true },

				ConnectedPubs: { schemaName: CoreSchemaType.String, relation: true },

				"Issue Article": { schemaName: CoreSchemaType.Null, relation: true },
				"Issue Volume": { schemaName: CoreSchemaType.String },
				"Issue Number": { schemaName: CoreSchemaType.Number },
				ISSN: { schemaName: CoreSchemaType.String },
				Issues: { schemaName: CoreSchemaType.Null, relation: true },
				Articles: { schemaName: CoreSchemaType.String, relation: true },
				Journals: { schemaName: CoreSchemaType.Null, relation: true },
				// site settings

				Header: { schemaName: CoreSchemaType.Null, relation: true },
				// Banner
				Banner: { schemaName: CoreSchemaType.Null, relation: true },
				Logo: { schemaName: CoreSchemaType.FileUpload },
				"Background Image": { schemaName: CoreSchemaType.FileUpload },
				"Hide Site Header Logo on Homepage": { schemaName: CoreSchemaType.Boolean },
				"Background Color": { schemaName: CoreSchemaType.String },
				"Text Color": { schemaName: CoreSchemaType.String },
				Align: { schemaName: CoreSchemaType.String },
				"Banner Buttons": { schemaName: CoreSchemaType.Null, relation: true },

				Footer: { schemaName: CoreSchemaType.Null, relation: true },

				// Facets
				"Citation Style": { schemaName: CoreSchemaType.String },
				"Copyright Year": { schemaName: CoreSchemaType.String },
				"Inline Citation Style": { schemaName: CoreSchemaType.String },
				"Pub Header Background Image": { schemaName: CoreSchemaType.FileUpload },
				"Pub Header Background Color": { schemaName: CoreSchemaType.String },
				"Pub Header Text Style": { schemaName: CoreSchemaType.String },

				Navigation: { schemaName: CoreSchemaType.Null, relation: true },
				"Navigation Items": { schemaName: CoreSchemaType.Null, relation: true },

				"External Link": { schemaName: CoreSchemaType.URL },
				"Open In New Tab": { schemaName: CoreSchemaType.Boolean },
				Pages: { schemaName: CoreSchemaType.Null, relation: true },
				Width: { schemaName: CoreSchemaType.String },
				Privacy: { schemaName: CoreSchemaType.String },
			},
			pubTypes: {
				"Navigation Item": {
					Title: { isTitle: true },
					"External Link": { isTitle: false },
					"Open In New Tab": { isTitle: false },
					// nested navigation
					"Navigation Items": { isTitle: false },
				},
				Navigation: {
					Title: { isTitle: true },
					"Navigation Items": { isTitle: false },
				},
				"Banner Button": {
					Title: { isTitle: true },
					"External Link": { isTitle: false },
				},
				Banner: {
					Title: { isTitle: true },
					Description: { isTitle: false },
					"Text Color": { isTitle: false },
					"Background Color": { isTitle: false },
					"Background Image": { isTitle: false },
					Logo: { isTitle: false },
					"External Link": { isTitle: false },
					Align: { isTitle: false },
					"Banner Buttons": { isTitle: false },
				},
				Header: {
					Title: { isTitle: true },
					Logo: { isTitle: false },
					"Background Color": { isTitle: false },
					"Text Color": { isTitle: false },
					// header has a banner
					Banner: { isTitle: false },
					// header has navigation
					Navigation: { isTitle: false },
				},
				Page: {
					Title: { isTitle: true },
					Slug: { isTitle: false },
					Avatar: { isTitle: false },
					Description: { isTitle: false },
					Width: { isTitle: false },
					Privacy: { isTitle: false },
					Content: { isTitle: false },
				},
				Footer: {
					Title: { isTitle: true },
					"Text Color": { isTitle: false },
					"Background Color": { isTitle: false },
					"Background Image": { isTitle: false },
					Logo: { isTitle: false },
					"External Link": { isTitle: false },
					Navigation: { isTitle: false },
				},
				Site: {
					Title: { isTitle: true },
					Description: { isTitle: false },
					Slug: { isTitle: false },
					Pages: { isTitle: false },
					Journals: { isTitle: false },
					Header: { isTitle: false },
					Footer: { isTitle: false },
				},
				Tag: {
					Title: { isTitle: true },
				},
				Journal: {
					Title: { isTitle: true },
					Description: { isTitle: false },
					Slug: { isTitle: false },
					ISSN: { isTitle: false },
					DOI: { isTitle: false },
					Avatar: { isTitle: false },
					Issues: { isTitle: false },
					Editors: { isTitle: false },
				},
				Issue: {
					Title: { isTitle: true },
					Articles: { isTitle: false },
					Description: { isTitle: false },
					DOI: { isTitle: false },
					Downloads: { isTitle: false },
					ISSN: { isTitle: false },
				},
				"Journal Article": {
					Title: { isTitle: true },
					Slug: { isTitle: false },
					Abstract: { isTitle: false },
					"Last Edited": { isTitle: false },
					"Publication Date": { isTitle: false },
					DOI: { isTitle: false },
					"DOI Suffix": { isTitle: false },
					URL: { isTitle: false },
					Content: { isTitle: false },
					License: { isTitle: false },
					Description: { isTitle: false },
					"Creation Date": { isTitle: false },
					Avatar: { isTitle: false },
					Contributors: { isTitle: false },
					Tag: { isTitle: false },
					Editors: { isTitle: false },
					Downloads: { isTitle: false },
					Images: { isTitle: false },
					Citations: { isTitle: false },
					"Inline Citation Style": { isTitle: false },
					"Citation Style": { isTitle: false },
					Tables: { isTitle: false },
					ConnectedPubs: { isTitle: false },
				},
				"PDF Download": {
					Title: { isTitle: true },
					PDF: { isTitle: false },
				},
				"Pub Image": {
					Title: { isTitle: true },
					"Pub Image": { isTitle: false },
					Caption: { isTitle: false },
				},
				Author: {
					Name: { isTitle: true },
					ORCiD: { isTitle: false },
					Affiliation: { isTitle: false },
					MemberId: { isTitle: false },
					Articles: { isTitle: false },
				},
				Editor: {
					Name: { isTitle: true },
					ORCiD: { isTitle: false },
					Affiliation: { isTitle: false },
				},
				ExternalBook: {
					Title: { isTitle: true },
					Year: { isTitle: false },
					DOI: { isTitle: false },
					"External Link": { isTitle: false },
				},
				ExternalJournalArticle: {
					Title: { isTitle: true },
					Year: { isTitle: false },
					DOI: { isTitle: false },
					"External Link": { isTitle: false },
				},
				Table: {
					Title: { isTitle: true },
					Caption: { isTitle: false },
					CSV: { isTitle: false },
				},
			},
			users: {
				"legacy-user-1": {
					email: "legacy@pubstar.org",
					role: MemberRole.admin,
					password: "pubstar-legacy",
				},
				...usersExisting,
			},
			stages: {
				"Test Pubs": {},
				Articles: {
					members: { "legacy-user-1": MemberRole.editor },
				},
				// these stages are mostly here to provide slightly easier grouping of the relevant pubs
				Authors: {},
				Sites: {},
				Journals: {},
				Issues: {},
				Navigations: {},
				Tags: {},
				"Stage 2": {
					members: { "legacy-user-1": MemberRole.editor },
				},
			},
			stageConnections: {
				Articles: {
					to: ["Stage 2"],
				},
			},
			pubs: [
				{
					pubType: "Site",
					stage: "Sites",
					values: {
						Title: "Legacy",
						Description: "We're reimagining scientific publication.",
					},
					relatedPubs: {
						Header: [
							{
								value: null,
								pub: {
									pubType: "Header",
									values: {
										"Background Color": "#000000",
										"Text Color": "#ffffff",
									},
									relatedPubs: {
										Banner: [],
										Navigation: [
											{
												value: null,
												pub: {
													pubType: "Navigation",
													stage: "Navigations",
													values: {
														Title: "Header Navigation",
													},
													relatedPubs: {
														"Navigation Items": [
															{
																value: null,
																pub: {
																	pubType: "Navigation Item",
																	values: {
																		Title: "Home",
																		"External Link":
																			"https://legacy-research.pubpub.org",
																	},
																},
															},
														],
													},
												},
											},
										],
									},
								},
							},
						],
						Footer: [
							{
								value: null,
								pub: {
									pubType: "Footer",
									values: {
										Title: "Website Footer",
										"Background Color": "#000000",
										"Text Color": "#ffffff",
									},
									relatedPubs: {
										Navigation: [
											{
												value: null,
												pub: {
													pubType: "Navigation",
													stage: "Navigations",
													values: { Title: "Footer Navigation" },
													relatedPubs: {
														"Navigation Items": [
															{
																value: null,
																pub: {
																	pubType: "Navigation Item",
																	values: {
																		Title: "Legal",
																		"External Link":
																			"https://legacy-research.pubpub.org/legal",
																		"Open In New Tab": true,
																	},
																},
															},
														],
													},
												},
											},
										],
									},
								},
							},
						],
						Journals: [
							{
								value: null,
								pub: {
									pubType: "Journal",
									stage: "Journals",
									values: {
										Title: "Legacy",
										DOI: "10.82234/legacy-ad7f-7a6d",
										ISSN: "2998-4084",
										Slug: "legacy",
									},
									relatedPubs: {
										Issues: [
											{
												value: null,
												pub: {
													pubType: "Issue",
													stage: "Issues",
													values: {
														Title: "Issue 1",
														ISSN: "2998-4084",
														DOI: "10.82234/legacy-ad7f-7a6d",
														Description: "A stimulating description.",
													},
													relatedPubs: {
														Articles: [
															{
																value: "",
																pub: {
																	value: "",
																	id: articleId,
																	pubType: "Journal Article",
																	stage: "Test Pubs",
																	values: {
																		Title: "The Complexity of Joint Regeneration: How an Advanced Implant Could Fail by Its In Vivo Proven Bone Component",
																		"Publication Date":
																			new Date(),
																		"Creation Date": new Date(),
																		"Last Edited": new Date(),
																		Avatar: "https://www.pubpub.org/static/logo.png",
																		Description:
																			"Orginal article by Paweena Diloksumpan, Florencia Abinzano, Mylène de Ruijter, Anneloes Mensinga, Saskia Plomp, Ilyas Khan, Harold Brommer, Ineke Smit, Miguel Dias Castilho, P. René van Weeren, Jos Malda, and Riccardo Levato, published in the Journal of Trial and Error 2021, https://doi.org/10.36850/e3 ",
																		Abstract: abstract,
																		License: "CC-BY 4.0",
																		Content: poniesText,
																		DOI: "10.82234/legacy-14b2-6f27",
																		URL: "https://www.pubpub.org",
																		"Inline Citation Style":
																			"Author Year",
																		"Citation Style": "APA 7",
																	},

																	relatedPubs: {
																		Tag: [
																			{
																				value: null,
																				pub: {
																					stage: "Tags",
																					pubType: "Tag",
																					values: {
																						Title: "Icebox",
																					},
																				},
																			},
																		],
																		// connections in Legacy
																		ConnectedPubs: [
																			{
																				value: "isCommentOn",
																				pub: {
																					id: articleId2,
																					pubType:
																						"Journal Article",
																					values: {
																						Title: "A Comment on Capsid Identification",
																					},
																				},
																			},
																		],
																		Contributors: [
																			{
																				value: "Editing & Draft Preparation",
																				pub: {
																					id: authorId,
																					stage: "Authors",
																					pubType:
																						"Author",
																					values: {
																						Name: "James McJimothy",
																						ORCiD: "https://orcid.org/0000-0000-0000-0000",
																						Affiliation:
																							"University of Somewhere",
																						// We can't do this because of foreign key constraints even though we know the IDs in advance
																						// These values are explicitly added after the seed function runs
																						// Articles: [
																						// 	{
																						// 		relatedPubId:
																						// 			articleId,
																						// 		value: "Edited",
																						// 	},
																						// 	{
																						// 		value: "Wrote",
																						// 		relatedPubId:
																						// 			articleId2,
																						// 	},
																						// ],
																					},
																				},
																			},
																		],
																		Downloads: [
																			{
																				// acting as a description of the download
																				value: "PDF Download",
																				pub: {
																					pubType:
																						"PDF Download",
																					// can't really add the actual file here
																					values: {},
																				},
																			},
																		],
																		Tables: [
																			{
																				value: null,
																				pub: {
																					pubType:
																						"Table",
																					values: {
																						Caption:
																							"A beautiful table.",
																						CSV: [],
																					},
																				},
																			},
																			{
																				value: null,
																				pub: {
																					pubType:
																						"Table",
																					values: {
																						Caption:
																							"A glorious table.",
																						CSV: [],
																					},
																				},
																			},
																		],
																		Images: [
																			{
																				value: null,
																				pub: {
																					pubType:
																						"Pub Image",
																					values: {
																						Caption:
																							"A beautiful image.",
																					},
																				},
																			},
																		],
																		Citations: [
																			{
																				value: "Chapter 5",
																				pub: {
																					pubType:
																						"ExternalBook",
																					values: {
																						Title: "A Great Book",
																						DOI: "10.82234/legacy-ad7f-7a6d",
																						Year: "2022",
																					},
																				},
																			},
																			{
																				value: "pp. 35-53",
																				pub: {
																					pubType:
																						"ExternalJournalArticle",
																					values: {
																						Title: "A Great Journal Article",
																						DOI: "10.82234/legacy-ad7f-7a6d",
																						Year: "2022",
																					},
																				},
																			},
																		],
																	},
																},
															},
															...articleSeed(100, true),
														],
													},
												},
											},
										],
									},
								},
							},
						],
					},
				},
			],
			forms: {},
			apiTokens: {
				allToken: {
					id: "00000000-0000-0000-0000-000000000000.xxxxxxxxxxxxxxxxxxxxxx",
				},
			},
		},
		{
			randomSlug: false,
			parallelPubs: true,
		}
	)

	// Give jimothy a circular reference
	await db
		.insertInto("pub_values")
		.values([
			{
				pubId: authorId as PubsId,
				relatedPubId: articleId as PubsId,
				value: '"Edited"',
				fieldId: seed.pubFields.Articles.id,
				lastModifiedBy: createLastModifiedBy("system"),
				rank: "0",
			},
			{
				pubId: authorId as PubsId,
				value: '"Wrote"',
				relatedPubId: articleId2 as PubsId,
				fieldId: seed.pubFields.Articles.id,
				lastModifiedBy: createLastModifiedBy("system"),
				rank: "1",
			},
		])
		.execute()

	return seed
}
