"use client"

import type { CoarNotifyPayload } from "~/lib/store"

import { useState } from "react"

import {
	createAcceptPayload,
	createAnnounceIngestPayload,
	createAnnounceReviewPayload,
	createOfferIngestPayload,
	createOfferReviewPayload,
	createRejectPayload,
	type PayloadTemplateType,
} from "~/lib/payloads"

interface SendNotificationFormProps {
	onSent: () => void
	/** Pre-fill values for a response to an existing notification */
	prefill?: {
		targetUrl?: string
		templateType?: PayloadTemplateType
		inReplyTo?: string
		inReplyToObjectUrl?: string
		originUrl?: string
		targetServiceUrl?: string
	}
}

type FormMode = "template" | "custom"

const TEMPLATE_OPTIONS: PayloadTemplateType[] = [
	"Offer Review",
	"Announce Review",
	"Offer Ingest",
	"Announce Ingest",
	"Accept",
	"Reject",
]

export function SendNotificationForm({ onSent, prefill }: SendNotificationFormProps) {
	const [mode, setMode] = useState<FormMode>("template")
	const [targetUrl, setTargetUrl] = useState(
		prefill?.targetUrl ??
			"http://localhost:3000/api/v0/c/coar-us2-unjournal/site/webhook/coar-inbox"
	)
	const [templateType, setTemplateType] = useState<PayloadTemplateType>(
		prefill?.templateType ?? "Offer Review"
	)
	const [customPayload, setCustomPayload] = useState("")
	const [isSending, setIsSending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [success, setSuccess] = useState(false)

	// Template fields - using complete URLs instead of IDs
	const [objectUrl, setObjectUrl] = useState(
		prefill?.inReplyToObjectUrl ?? "https://www.biorxiv.org/content/10.1101/2024.01.01.123456"
	)
	const [objectCiteAs, setObjectCiteAs] = useState("")
	const [objectItemUrl, setObjectItemUrl] = useState("")
	const [reviewUrl, setReviewUrl] = useState("http://localhost:4001/reviews/sample-review")
	const [originUrl, setOriginUrl] = useState(prefill?.originUrl ?? "http://localhost:4001")
	const [targetServiceUrl, setTargetServiceUrl] = useState(
		prefill?.targetServiceUrl ?? "http://localhost:3000"
	)
	const [serviceName, setServiceName] = useState("Mock Review Service")
	const [inReplyTo, setInReplyTo] = useState(prefill?.inReplyTo ?? "")
	const [inReplyToUrl, setInReplyToUrl] = useState(prefill?.inReplyToObjectUrl ?? "")
	const [workUrl, setWorkUrl] = useState(
		"http://localhost:3000/c/coar-us4-repository/pub/{pubId}"
	)

	const generatePayload = (): CoarNotifyPayload => {
		switch (templateType) {
			case "Offer Review":
				return createOfferReviewPayload({
					objectUrl,
					objectCiteAs: objectCiteAs || undefined,
					objectItemUrl: objectItemUrl || undefined,
					originUrl,
					targetUrl: targetServiceUrl,
				})
			case "Announce Review":
				return createAnnounceReviewPayload({
					reviewUrl,
					inReplyToUrl: inReplyToUrl || objectUrl,
					originUrl,
					targetUrl: targetServiceUrl,
					serviceName,
				})
			case "Offer Ingest":
				return createOfferIngestPayload({
					reviewUrl,
					originUrl,
					targetUrl: targetServiceUrl,
				})
			case "Announce Ingest":
				return createAnnounceIngestPayload({
					reviewUrl,
					originUrl,
					targetUrl: targetServiceUrl,
					workUrl: workUrl || undefined,
				})
			case "Accept":
				return createAcceptPayload({
					inReplyTo,
					originUrl,
					targetUrl: targetServiceUrl,
					serviceName,
				})
			case "Reject":
				return createRejectPayload({
					inReplyTo,
					originUrl,
					targetUrl: targetServiceUrl,
					serviceName,
				})
		}
	}

	const handleSend = async () => {
		setError(null)
		setSuccess(false)
		setIsSending(true)

		try {
			let payload: CoarNotifyPayload
			if (mode === "template") {
				payload = generatePayload()
			} else {
				payload = JSON.parse(customPayload)
			}

			const res = await fetch("/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ targetUrl, payload }),
			})

			const data = await res.json()

			if (!res.ok) {
				setError(data.error || "Failed to send notification")
			} else {
				setSuccess(true)
				onSent()
				setTimeout(() => setSuccess(false), 3000)
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to send notification")
		} finally {
			setIsSending(false)
		}
	}

	const handlePreview = () => {
		try {
			const payload = generatePayload()
			setCustomPayload(JSON.stringify(payload, null, 2))
			setMode("custom")
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to generate payload")
		}
	}

	const renderTemplateFields = () => {
		switch (templateType) {
			case "Offer Review":
				return (
					<>
						<div>
							<label className="mb-1 block font-medium text-gray-700 text-sm">
								Object URL (preprint/article to review)
								<input
									type="text"
									value={objectUrl}
									onChange={(e) => setObjectUrl(e.target.value)}
									placeholder="https://www.biorxiv.org/content/10.1101/..."
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
							</label>
						</div>
						<div>
							<label className="mb-1 block font-medium text-gray-700 text-sm">
								Cite As DOI (optional)
								<input
									type="text"
									value={objectCiteAs}
									onChange={(e) => setObjectCiteAs(e.target.value)}
									placeholder="https://doi.org/10.1101/2024.01.01.123456"
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
							</label>
						</div>
						<div>
							<label className="mb-1 block font-medium text-gray-700 text-sm">
								Item URL (optional, e.g. PDF link)
								<input
									type="text"
									value={objectItemUrl}
									onChange={(e) => setObjectItemUrl(e.target.value)}
									placeholder="http://example.com/paper.pdf"
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
							</label>
						</div>
						<div>
							<label className="mb-1 block font-medium text-gray-700 text-sm">
								Origin URL (this service)
								<input
									type="text"
									value={originUrl}
									onChange={(e) => setOriginUrl(e.target.value)}
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
							</label>
						</div>
						<div>
							<label className="mb-1 block font-medium text-gray-700 text-sm">
								Target Service URL
								<input
									type="text"
									value={targetServiceUrl}
									onChange={(e) => setTargetServiceUrl(e.target.value)}
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
							</label>
						</div>
					</>
				)
			case "Announce Review":
				return (
					<>
						<div>
							<label className="mb-1 block font-medium text-gray-700 text-sm">
								Review URL (full URL of the review)
								<input
									type="text"
									value={reviewUrl}
									onChange={(e) => setReviewUrl(e.target.value)}
									placeholder="http://localhost:4000/review/..."
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
							</label>
						</div>
						<div>
							<label className="mb-1 block font-medium text-gray-700 text-sm">
								In Reply To URL (the original preprint/pub)
								<input
									type="text"
									value={inReplyToUrl}
									onChange={(e) => setInReplyToUrl(e.target.value)}
									placeholder="http://localhost:3000/c/community/pub/..."
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
							</label>
						</div>
						<div>
							<label className="mb-1 block font-medium text-gray-700 text-sm">
								Origin URL (this service)
								<input
									type="text"
									value={originUrl}
									onChange={(e) => setOriginUrl(e.target.value)}
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
							</label>
						</div>
						<div>
							<label className="mb-1 block font-medium text-gray-700 text-sm">
								Target Service URL (where to send)
								<input
									type="text"
									value={targetServiceUrl}
									onChange={(e) => setTargetServiceUrl(e.target.value)}
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
							</label>
						</div>
						<div>
							<label
								htmlFor="serviceName"
								className="mb-1 block font-medium text-gray-700 text-sm"
							>
								Service Name
							</label>
							<input
								type="text"
								id="serviceName"
								value={serviceName}
								onChange={(e) => setServiceName(e.target.value)}
								className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
							/>
						</div>
					</>
				)
			case "Offer Ingest":
				return (
					<>
						<div>
							<label className="mb-1 block font-medium text-gray-700 text-sm">
								Review URL (full URL)
								<input
									type="text"
									value={reviewUrl}
									onChange={(e) => setReviewUrl(e.target.value)}
									placeholder="http://localhost:4001/review/..."
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
							</label>
						</div>
						<div>
							<label className="mb-1 block font-medium text-gray-700 text-sm">
								Origin URL (this service)
								<input
									type="text"
									value={originUrl}
									onChange={(e) => setOriginUrl(e.target.value)}
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
							</label>
						</div>
						<div>
							<label
								htmlFor="aggregatorUrl"
								className="mb-1 block font-medium text-gray-700 text-sm"
							>
								Aggregator URL
							</label>
							<input
								type="text"
								value={targetServiceUrl}
								onChange={(e) => setTargetServiceUrl(e.target.value)}
								className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
							/>
						</div>
					</>
				)
			case "Announce Ingest":
				return (
					<>
						<div>
							<label className="mb-1 block font-medium text-gray-700 text-sm">
								Review URL (full URL)
								<input
									type="text"
									value={reviewUrl}
									onChange={(e) => setReviewUrl(e.target.value)}
									placeholder="http://localhost:4001/review/..."
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
							</label>
						</div>
						<div>
							<label className="mb-1 block font-medium text-gray-700 text-sm">
								Work URL (as:inReplyTo) - pub URL containing the work being reviewed
								<input
									type="text"
									value={workUrl}
									onChange={(e) => setWorkUrl(e.target.value)}
									placeholder="http://localhost:3000/c/coar-us4-repository/pub/{pubId}"
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
							</label>
						</div>
						<div>
							<label className="mb-1 block font-medium text-gray-700 text-sm">
								Origin URL (this service)
								<input
									type="text"
									value={originUrl}
									onChange={(e) => setOriginUrl(e.target.value)}
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
							</label>
						</div>
						<div>
							<label
								htmlFor="aggregatorUrl"
								className="mb-1 block font-medium text-gray-700 text-sm"
							>
								Aggregator URL
							</label>
							<input
								type="text"
								value={targetServiceUrl}
								onChange={(e) => setTargetServiceUrl(e.target.value)}
								className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
							/>
						</div>
					</>
				)
			case "Accept":
			case "Reject":
				return (
					<>
						<div>
							<label
								htmlFor="inReplyTo"
								className="mb-1 block font-medium text-gray-700 text-sm"
							>
								In Reply To (Offer ID)
							</label>
							<input
								type="text"
								id="inReplyTo"
								value={inReplyTo}
								onChange={(e) => setInReplyTo(e.target.value)}
								placeholder="urn:uuid:..."
								className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
							/>
						</div>
						<div>
							<label className="mb-1 block font-medium text-gray-700 text-sm">
								Origin URL (this service)
								<input
									type="text"
									value={originUrl}
									onChange={(e) => setOriginUrl(e.target.value)}
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
							</label>
						</div>
						<div>
							<label className="mb-1 block font-medium text-gray-700 text-sm">
								Target Service URL
								<input
									type="text"
									value={targetServiceUrl}
									onChange={(e) => setTargetServiceUrl(e.target.value)}
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
							</label>
						</div>
						<div>
							<label className="mb-1 block font-medium text-gray-700 text-sm">
								Service Name
								<input
									type="text"
									value={serviceName}
									onChange={(e) => setServiceName(e.target.value)}
									className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
								/>
							</label>
						</div>
					</>
				)
		}
	}

	return (
		<div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
			<h2 className="mb-4 font-semibold text-lg">Send Notification</h2>

			{/* Mode Toggle */}
			<div className="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1">
				<button
					type="button"
					onClick={() => setMode("template")}
					className={`flex-1 rounded-md px-3 py-1.5 font-medium text-sm transition-colors ${
						mode === "template"
							? "bg-white text-gray-900 shadow-sm"
							: "text-gray-600 hover:text-gray-900"
					}`}
				>
					Template
				</button>
				<button
					type="button"
					onClick={() => setMode("custom")}
					className={`flex-1 rounded-md px-3 py-1.5 font-medium text-sm transition-colors ${
						mode === "custom"
							? "bg-white text-gray-900 shadow-sm"
							: "text-gray-600 hover:text-gray-900"
					}`}
				>
					Custom JSON
				</button>
			</div>

			<div className="space-y-4">
				{/* Target URL */}
				<div>
					<label
						htmlFor="targetUrl"
						className="mb-1 block font-medium text-gray-700 text-sm"
					>
						Target URL
					</label>
					<input
						id="targetUrl"
						type="text"
						value={targetUrl}
						onChange={(e) => setTargetUrl(e.target.value)}
						className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
						placeholder="http://localhost:3000/api/v0/c/..."
					/>
				</div>

				{mode === "template" ? (
					<>
						{/* Template Type */}
						<div>
							<label
								htmlFor="templateType"
								className="mb-1 block font-medium text-gray-700 text-sm"
							>
								Notification Type
							</label>
							<select
								id="templateType"
								value={templateType}
								onChange={(e) =>
									setTemplateType(e.target.value as PayloadTemplateType)
								}
								className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
							>
								{TEMPLATE_OPTIONS.map((opt) => (
									<option key={opt} value={opt}>
										{opt}
									</option>
								))}
							</select>
						</div>

						{/* Template-specific fields */}
						{renderTemplateFields()}

						{/* Preview button */}
						<button
							type="button"
							onClick={handlePreview}
							className="w-full rounded-md border border-gray-300 bg-white px-4 py-2 font-medium text-gray-700 text-sm hover:bg-gray-50"
						>
							Preview JSON
						</button>
					</>
				) : (
					<div>
						<label
							htmlFor="customPayload"
							className="mb-1 block font-medium text-gray-700 text-sm"
						>
							JSON Payload
						</label>
						<textarea
							id="customPayload"
							value={customPayload}
							onChange={(e) => setCustomPayload(e.target.value)}
							className="h-64 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
							placeholder='{"@context": [...], "type": [...], ...}'
						/>
					</div>
				)}

				{/* Error/Success Messages */}
				{error && (
					<div className="rounded-md bg-red-50 p-3 text-red-700 text-sm">{error}</div>
				)}
				{success && (
					<div className="rounded-md bg-green-50 p-3 text-green-700 text-sm">
						Notification sent successfully!
					</div>
				)}

				{/* Send Button */}
				<button
					type="button"
					onClick={handleSend}
					disabled={isSending}
					className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{isSending ? "Sending..." : "Send Notification"}
				</button>
			</div>
		</div>
	)
}
