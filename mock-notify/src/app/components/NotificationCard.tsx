"use client"

import type { StoredNotification } from "~/lib/store"

import { useState } from "react"

import {
	getAvailableFollowUps,
	getAvailableResponses,
	type PayloadTemplateType,
} from "~/lib/payloads"

interface NotificationCardProps {
	notification: StoredNotification
	notifications: StoredNotification[]
	onDelete: () => void
	onRespond?: (responseType: PayloadTemplateType, prefill: ResponsePrefill) => void
	isLatest?: boolean
}

export interface ResponsePrefill {
	targetUrl: string
	templateType: PayloadTemplateType
	inReplyTo: string
	inReplyToObjectUrl: string
	originUrl: string
	targetServiceUrl: string
}

export function NotificationCard({
	notification,
	notifications,
	onDelete,
	isLatest,
	onRespond,
}: NotificationCardProps) {
	const [isExpanded, setIsExpanded] = useState(false)

	const types = Array.isArray(notification.payload.type)
		? notification.payload.type
		: [notification.payload.type]

	const availableResponses =
		notification.direction === "received" ? getAvailableResponses(notification.payload) : []
	const availableFollowUps =
		notification.direction === "sent" && notification.status === "success"
			? getAvailableFollowUps(notification.payload)
			: []

	const getTypeColor = (type: string) => {
		if (type.includes("Offer")) return "bg-blue-100 text-blue-800"
		if (type.includes("Announce")) return "bg-green-100 text-green-800"
		if (type.includes("Accept")) return "bg-emerald-100 text-emerald-800"
		if (type.includes("Reject")) return "bg-red-100 text-red-800"
		return "bg-gray-100 text-gray-800"
	}

	const getResponseButtonColor = (responseType: string) => {
		if (responseType === "Accept") return "bg-emerald-600 hover:bg-emerald-700 text-white"
		if (responseType === "Reject") return "bg-red-600 hover:bg-red-700 text-white"
		if (responseType.includes("Announce")) return "bg-green-600 hover:bg-green-700 text-white"
		return "bg-gray-600 hover:bg-gray-700 text-white"
	}

	const getDirectionBadge = () => {
		if (notification.direction === "received") {
			return (
				<span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 font-medium text-purple-800 text-xs">
					<svg
						className="h-3 w-3"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						aria-hidden="true"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
						/>
					</svg>
					Received
				</span>
			)
		}
		return (
			<span
				className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs ${
					notification.status === "success"
						? "bg-teal-100 text-teal-800"
						: "bg-orange-100 text-orange-800"
				}`}
			>
				<svg
					className="h-3 w-3"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					aria-hidden="true"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
					/>
				</svg>
				Sent {notification.status === "error" && "(Failed)"}
			</span>
		)
	}

	const handleRespond = (responseType: PayloadTemplateType) => {
		if (!onRespond) return

		const payload = notification.payload

		if (notification.direction === "sent") {
			// Follow-up on a sent notification (e.g., Announce after Accept)
			// For Accept follow-ups, look up the original received Offer to get the paper URL
			let inReplyToObjectUrl = payload.object?.id ?? ""
			if (payload.inReplyTo) {
				const originalNotification = notifications.find(
					(n) => n.direction === "received" && n.payload.id === payload.inReplyTo
				)
				if (originalNotification?.payload.object?.id) {
					inReplyToObjectUrl = originalNotification.payload.object.id
				}
			}

			const prefill: ResponsePrefill = {
				targetUrl: notification.targetUrl ?? "",
				templateType: responseType,
				inReplyTo: payload.inReplyTo ?? payload.id,
				inReplyToObjectUrl,
				originUrl: payload.origin?.id ?? "http://localhost:4001",
				targetServiceUrl: payload.target?.id ?? "",
			}
			onRespond(responseType, prefill)
		} else {
			// Response to a received notification
			const originInbox = payload.origin?.inbox ?? `${payload.origin?.id}/inbox/`
			const prefill: ResponsePrefill = {
				targetUrl: originInbox,
				templateType: responseType,
				inReplyTo: payload.id,
				inReplyToObjectUrl: payload.object?.id ?? "",
				originUrl: "http://localhost:4001",
				targetServiceUrl: payload.origin?.id ?? "",
			}
			onRespond(responseType, prefill)
		}
	}

	return (
		<div
			className={`px-6 py-4 ${isLatest ? "border-l-4 border-l-blue-500 bg-blue-50" : "hover:bg-gray-50"}`}
		>
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						{isLatest && (
							<span className="inline-flex items-center rounded-full bg-blue-600 px-2 py-0.5 font-medium text-white text-xs">
								Latest
							</span>
						)}
						{getDirectionBadge()}
						{types.map((type) => (
							<span
								key={type}
								className={`inline-flex rounded-full px-2 py-0.5 font-medium text-xs ${getTypeColor(type)}`}
							>
								{type}
							</span>
						))}
					</div>

					<p className="mt-2 truncate font-mono text-gray-600 text-sm">
						{notification.payload.id}
					</p>

					{notification.payload.object?.id && (
						<p className="mt-1 truncate text-gray-500 text-sm">
							Object:{" "}
							<a
								href={notification.payload.object.id}
								target="_blank"
								rel="noopener noreferrer"
								className="font-mono text-blue-600 hover:underline"
							>
								{notification.payload.object.id}
							</a>
						</p>
					)}

					{notification.direction === "sent" && notification.targetUrl && (
						<p className="mt-1 truncate text-gray-500 text-sm">
							To:{" "}
							<a
								href={notification.targetUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="font-mono text-blue-600 hover:underline"
							>
								{notification.targetUrl}
							</a>
						</p>
					)}

					{notification.direction === "received" && notification.payload.origin && (
						<p className="mt-1 truncate text-gray-500 text-sm">
							From:{" "}
							<a
								href={notification.payload.origin.id}
								target="_blank"
								rel="noopener noreferrer"
								className="font-mono text-blue-600 hover:underline"
							>
								{notification.payload.origin.id}
							</a>
						</p>
					)}

					{notification.error && (
						<p className="mt-1 text-red-600 text-sm">Error: {notification.error}</p>
					)}

					<p className="mt-1 text-gray-400 text-xs">
						{new Date(notification.timestamp).toLocaleString()}
					</p>

					{/* Response buttons */}
					{availableResponses.length > 0 && onRespond && (
						<div className="mt-3 flex flex-wrap gap-2">
							<span className="self-center text-gray-500 text-xs">Respond:</span>
							{availableResponses.map((responseType) => (
								<button
									type="button"
									key={responseType}
									onClick={() => handleRespond(responseType)}
									className={`rounded-md px-2.5 py-1 font-medium text-xs transition-colors ${getResponseButtonColor(responseType)}`}
								>
									{responseType}
								</button>
							))}
						</div>
					)}

					{/* Follow-up buttons for sent notifications */}
					{availableFollowUps.length > 0 && onRespond && (
						<div className="mt-3 flex flex-wrap gap-2">
							<span className="self-center text-gray-500 text-xs">Follow up:</span>
							{availableFollowUps.map((followUpType) => (
								<button
									type="button"
									key={followUpType}
									onClick={() => handleRespond(followUpType)}
									className={`rounded-md px-2.5 py-1 font-medium text-xs transition-colors ${getResponseButtonColor(followUpType)}`}
								>
									{followUpType}
								</button>
							))}
						</div>
					)}
				</div>

				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => setIsExpanded(!isExpanded)}
						className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
						title={isExpanded ? "Collapse" : "Expand"}
					>
						<svg
							aria-hidden="true"
							className={`h-5 w-5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M19 9l-7 7-7-7"
							/>
						</svg>
					</button>
					<button
						type="button"
						onClick={onDelete}
						className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
						title="Delete"
					>
						<svg
							className="h-5 w-5"
							aria-hidden="true"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
							/>
						</svg>
					</button>
				</div>
			</div>

			{isExpanded && (
				<div className="mt-4">
					<pre className="max-h-96 overflow-auto rounded-lg bg-gray-900 p-4 text-gray-100 text-sm">
						{JSON.stringify(notification.payload, null, 2)}
					</pre>
				</div>
			)}
		</div>
	)
}
