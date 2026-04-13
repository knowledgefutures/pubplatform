import { randomUUID } from "node:crypto"

export interface CoarNotifyPayload {
	"@context": string[]
	id: string
	type: string | string[]
	actor: {
		id: string
		type: string
		name: string
	}
	object: {
		id: string
		type: string | string[]
		[key: string]: unknown
	}
	target: {
		id: string
		type: string
		inbox?: string
	}
	origin: {
		id: string
		type: string
		inbox?: string
	}
	context?: {
		id: string
		type: string
	}
	inReplyTo?: string | null
}

export function createOfferReviewPayload({
	preprintId,
	repositoryUrl,
	serviceUrl,
}: {
	preprintId: string
	repositoryUrl: string
	serviceUrl: string
}): CoarNotifyPayload {
	const preprintUrl = `${repositoryUrl}/preprint/${preprintId}`
	return {
		"@context": ["https://www.w3.org/ns/activitystreams", "https://coar-notify.net"],
		id: `urn:uuid:${randomUUID()}`,
		type: ["Offer", "coar-notify:ReviewAction"],
		actor: {
			id: "https://orcid.org/0000-0002-1825-0097",
			type: "Person",
			name: "Josiah Carberry",
		},
		object: {
			id: preprintUrl,
			type: ["Page", "sorg:AboutPage"],
			"ietf:cite-as": `https://doi.org/10.5555/${preprintId}`,
			"ietf:item": {
				id: `${preprintUrl}/content.pdf`,
				mediaType: "application/pdf",
				type: ["Article", "sorg:ScholarlyArticle"],
			},
		},
		target: {
			id: serviceUrl,
			inbox: `${serviceUrl}/inbox/`,
			type: "Service",
		},
		origin: {
			id: repositoryUrl,
			inbox: `${repositoryUrl}/inbox/`,
			type: "Service",
		},
	}
}

export function createAnnounceReviewPayload({
	preprintId,
	reviewId,
	repositoryUrl,
	serviceUrl,
	serviceName,
}: {
	preprintId: string
	reviewId: string
	repositoryUrl: string
	serviceUrl: string
	serviceName: string
}): CoarNotifyPayload {
	const preprintUrl = `${repositoryUrl}/preprint/${preprintId}`
	const reviewUrl = `${serviceUrl}/review/${reviewId}`
	return {
		"@context": ["https://www.w3.org/ns/activitystreams", "https://coar-notify.net"],
		id: `urn:uuid:${randomUUID()}`,
		type: ["Announce", "coar-notify:ReviewAction"],
		actor: {
			id: serviceUrl,
			type: "Service",
			name: serviceName,
		},
		object: {
			id: reviewUrl,
			type: ["Page", "sorg:Review"],
			"as:inReplyTo": preprintUrl,
		},
		target: {
			id: repositoryUrl,
			inbox: `${repositoryUrl}/inbox/`,
			type: "Service",
		},
		origin: {
			id: serviceUrl,
			inbox: `${serviceUrl}/inbox/`,
			type: "Service",
		},
		context: {
			id: preprintUrl,
			type: "Page",
		},
	}
}

export function createRejectPayload({
	inReplyTo,
	repositoryUrl,
	serviceUrl,
}: {
	inReplyTo: string
	repositoryUrl: string
	serviceUrl: string
}): CoarNotifyPayload {
	return {
		"@context": ["https://www.w3.org/ns/activitystreams", "https://coar-notify.net"],
		id: `urn:uuid:${randomUUID()}`,
		type: ["Reject"],
		inReplyTo,
		actor: {
			id: serviceUrl,
			type: "Service",
			name: "Service Name",
		},
		object: {
			id: inReplyTo,
			type: "Offer",
		},
		target: {
			id: repositoryUrl,
			inbox: `${repositoryUrl}/inbox/`,
			type: "Service",
		},
		origin: {
			id: serviceUrl,
			inbox: `${serviceUrl}/inbox/`,
			type: "Service",
		},
	}
}

export function createAcceptPayload({
	inReplyTo,
	repositoryUrl,
	serviceUrl,
}: {
	inReplyTo: string
	repositoryUrl: string
	serviceUrl: string
}): CoarNotifyPayload {
	return {
		"@context": ["https://www.w3.org/ns/activitystreams", "https://coar-notify.net"],
		id: `urn:uuid:${randomUUID()}`,
		type: ["Accept"],
		inReplyTo,
		actor: {
			id: serviceUrl,
			type: "Service",
			name: "Service Name",
		},
		object: {
			id: inReplyTo,
			type: "Offer",
		},
		target: {
			id: repositoryUrl,
			inbox: `${repositoryUrl}/inbox/`,
			type: "Service",
		},
		origin: {
			id: serviceUrl,
			inbox: `${serviceUrl}/inbox/`,
			type: "Service",
		},
	}
}

export function createOfferIngestPayload({
	reviewId,
	serviceUrl,
	aggregatorUrl,
}: {
	reviewId: string
	serviceUrl: string
	aggregatorUrl: string
}): CoarNotifyPayload {
	const reviewUrl = `${serviceUrl}/review/${reviewId}`
	return {
		"@context": ["https://www.w3.org/ns/activitystreams", "https://coar-notify.net"],
		id: `urn:uuid:${randomUUID()}`,
		type: ["Offer", "coar-notify:IngestAction"],
		actor: {
			id: serviceUrl,
			type: "Service",
			name: "Review Group",
		},
		object: {
			id: reviewUrl,
			type: ["Page", "sorg:Review"],
		},
		target: {
			id: aggregatorUrl,
			inbox: `${aggregatorUrl}/inbox/`,
			type: "Service",
		},
		origin: {
			id: serviceUrl,
			inbox: `${serviceUrl}/inbox/`,
			type: "Service",
		},
	}
}

export function createAnnounceIngestPayload({
	reviewId,
	serviceUrl,
	aggregatorUrl,
	workUrl,
}: {
	reviewId: string
	serviceUrl: string
	aggregatorUrl: string
	workUrl?: string
}): CoarNotifyPayload {
	const reviewUrl = `${serviceUrl}/review/${reviewId}`
	return {
		"@context": ["https://www.w3.org/ns/activitystreams", "https://coar-notify.net"],
		id: `urn:uuid:${randomUUID()}`,
		type: ["Announce", "coar-notify:IngestAction"],
		actor: {
			id: aggregatorUrl,
			type: "Service",
			name: "Aggregator",
		},
		object: {
			id: reviewUrl,
			type: ["Page", "sorg:Review"],
			...(workUrl && { "as:inReplyTo": workUrl }),
		},
		target: {
			id: serviceUrl,
			inbox: `${serviceUrl}/inbox/`,
			type: "Service",
		},
		origin: {
			id: aggregatorUrl,
			inbox: `${aggregatorUrl}/inbox/`,
			type: "Service",
		},
	}
}
