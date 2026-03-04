import type { CoarNotifyPayload } from "./store"

/**
 * Helper functions to create COAR Notify payloads
 * All object IDs should be complete URLs, not fragments to be composed
 */

export function createOfferReviewPayload({
	objectUrl,
	objectCiteAs,
	objectItemUrl,
	actorId,
	actorName,
	originUrl,
	targetUrl,
}: {
	objectUrl: string
	objectCiteAs?: string
	objectItemUrl?: string
	actorId?: string
	actorName?: string
	originUrl: string
	targetUrl: string
}): CoarNotifyPayload {
	return {
		"@context": ["https://www.w3.org/ns/activitystreams", "https://coar-notify.net"],
		id: `urn:uuid:${crypto.randomUUID()}`,
		type: ["Offer", "coar-notify:ReviewAction"],
		actor: {
			id: actorId ?? "https://orcid.org/0000-0002-1825-0097",
			type: "Person",
			name: actorName ?? "Josiah Carberry",
		},
		object: {
			id: objectUrl,
			type: ["Page", "sorg:AboutPage"],
			...(objectCiteAs && { "ietf:cite-as": objectCiteAs }),
			...(objectItemUrl && {
				"ietf:item": {
					id: objectItemUrl,
					mediaType: "application/pdf",
					type: ["Article", "sorg:ScholarlyArticle"],
				},
			}),
		},
		target: {
			id: targetUrl,
			inbox: `${targetUrl}/inbox/`,
			type: "Service",
		},
		origin: {
			id: originUrl,
			inbox: `${originUrl}/inbox/`,
			type: "Service",
		},
	}
}

export function createAnnounceReviewPayload({
	reviewUrl,
	inReplyToUrl,
	originUrl,
	targetUrl,
	serviceName,
}: {
	reviewUrl: string
	inReplyToUrl: string
	originUrl: string
	targetUrl: string
	serviceName?: string
}): CoarNotifyPayload {
	return {
		"@context": ["https://www.w3.org/ns/activitystreams", "https://coar-notify.net"],
		id: `urn:uuid:${crypto.randomUUID()}`,
		type: ["Announce", "coar-notify:ReviewAction"],
		actor: {
			id: originUrl,
			type: "Service",
			name: serviceName ?? "Mock Review Service",
		},
		object: {
			id: reviewUrl,
			type: ["Page", "sorg:Review"],
			"as:inReplyTo": inReplyToUrl,
		},
		target: {
			id: targetUrl,
			inbox: `${targetUrl}/inbox/`,
			type: "Service",
		},
		origin: {
			id: originUrl,
			inbox: `${originUrl}/inbox/`,
			type: "Service",
		},
		context: {
			id: inReplyToUrl,
			type: "Page",
		},
	}
}

export function createOfferIngestPayload({
	reviewUrl,
	originUrl,
	targetUrl,
}: {
	reviewUrl: string
	originUrl: string
	targetUrl: string
}): CoarNotifyPayload {
	return {
		"@context": ["https://www.w3.org/ns/activitystreams", "https://coar-notify.net"],
		id: `urn:uuid:${crypto.randomUUID()}`,
		type: ["Offer", "coar-notify:IngestAction"],
		actor: {
			id: originUrl,
			type: "Service",
			name: "Review Group",
		},
		object: {
			id: reviewUrl,
			type: ["Page", "sorg:Review"],
		},
		target: {
			id: targetUrl,
			inbox: `${targetUrl}/inbox/`,
			type: "Service",
		},
		origin: {
			id: originUrl,
			inbox: `${originUrl}/inbox/`,
			type: "Service",
		},
	}
}

export function createAnnounceIngestPayload({
	reviewUrl,
	originUrl,
	targetUrl,
	workUrl,
}: {
	reviewUrl: string
	originUrl: string
	targetUrl: string
	workUrl?: string
}): CoarNotifyPayload {
	return {
		"@context": ["https://www.w3.org/ns/activitystreams", "https://coar-notify.net"],
		id: `urn:uuid:${crypto.randomUUID()}`,
		type: ["Announce", "coar-notify:IngestAction"],
		actor: {
			id: targetUrl,
			type: "Service",
			name: "Aggregator",
		},
		object: {
			id: reviewUrl,
			type: ["Page", "sorg:Review"],
			...(workUrl && { "as:inReplyTo": workUrl }),
		},
		target: {
			id: originUrl,
			inbox: `${originUrl}/inbox/`,
			type: "Service",
		},
		origin: {
			id: targetUrl,
			inbox: `${targetUrl}/inbox/`,
			type: "Service",
		},
	}
}

export function createAcceptPayload({
	inReplyTo,
	originUrl,
	targetUrl,
	serviceName,
}: {
	inReplyTo: string
	originUrl: string
	targetUrl: string
	serviceName?: string
}): CoarNotifyPayload {
	return {
		"@context": ["https://www.w3.org/ns/activitystreams", "https://coar-notify.net"],
		id: `urn:uuid:${crypto.randomUUID()}`,
		type: ["Accept"],
		inReplyTo,
		actor: {
			id: originUrl,
			type: "Service",
			name: serviceName ?? "Mock Service",
		},
		object: {
			id: inReplyTo,
			type: "Offer",
		},
		target: {
			id: targetUrl,
			inbox: `${targetUrl}/inbox/`,
			type: "Service",
		},
		origin: {
			id: originUrl,
			inbox: `${originUrl}/inbox/`,
			type: "Service",
		},
	}
}

export function createRejectPayload({
	inReplyTo,
	originUrl,
	targetUrl,
	serviceName,
}: {
	inReplyTo: string
	originUrl: string
	targetUrl: string
	serviceName?: string
}): CoarNotifyPayload {
	return {
		"@context": ["https://www.w3.org/ns/activitystreams", "https://coar-notify.net"],
		id: `urn:uuid:${crypto.randomUUID()}`,
		type: ["Reject"],
		inReplyTo,
		actor: {
			id: originUrl,
			type: "Service",
			name: serviceName ?? "Mock Service",
		},
		object: {
			id: inReplyTo,
			type: "Offer",
		},
		target: {
			id: targetUrl,
			inbox: `${targetUrl}/inbox/`,
			type: "Service",
		},
		origin: {
			id: originUrl,
			inbox: `${originUrl}/inbox/`,
			type: "Service",
		},
	}
}

export const PAYLOAD_TEMPLATES = {
	"Offer Review": createOfferReviewPayload,
	"Announce Review": createAnnounceReviewPayload,
	"Offer Ingest": createOfferIngestPayload,
	"Announce Ingest": createAnnounceIngestPayload,
	Accept: createAcceptPayload,
	Reject: createRejectPayload,
} as const

export type PayloadTemplateType = keyof typeof PAYLOAD_TEMPLATES

/**
 * Determine possible response types for a given notification
 */
export function getAvailableResponses(
	payload: CoarNotifyPayload
): Array<"Accept" | "Reject" | "Announce Review" | "Announce Ingest"> {
	const types = Array.isArray(payload.type) ? payload.type : [payload.type]

	if (types.includes("Offer") && types.includes("coar-notify:ReviewAction")) {
		return ["Accept", "Reject", "Announce Review"]
	}
	if (types.includes("Offer") && types.includes("coar-notify:IngestAction")) {
		return ["Accept", "Reject", "Announce Ingest"]
	}
	return []
}
