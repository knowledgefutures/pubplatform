"use client"

import type { PayloadTemplateType } from "~/lib/payloads"
import type { StoredNotification } from "~/lib/store"

import { useCallback, useEffect, useRef, useState } from "react"

import { NotificationCard, type ResponsePrefill } from "./components/NotificationCard"
import { SendNotificationForm } from "./components/SendNotificationForm"

export default function Home() {
	const [notifications, setNotifications] = useState<StoredNotification[]>([])
	const [filter, setFilter] = useState<"all" | "received" | "sent">("all")
	const [isLoading, setIsLoading] = useState(true)
	const [prefill, setPrefill] = useState<ResponsePrefill | undefined>(undefined)
	const [formKey, setFormKey] = useState(0)
	const formRef = useRef<HTMLDivElement>(null)

	const fetchNotifications = useCallback(async () => {
		try {
			const params = filter !== "all" ? `?direction=${filter}` : ""
			const res = await fetch(`/api/notifications${params}`)
			const data = await res.json()
			setNotifications(data.notifications)
		} catch (error) {
			// biome-ignore lint/suspicious/noConsole: shh
			console.error("Failed to fetch notifications:", error)
		} finally {
			setIsLoading(false)
		}
	}, [filter])

	useEffect(() => {
		void fetchNotifications()
		// Poll for new notifications every 2 seconds
		const interval = setInterval(fetchNotifications, 2000)
		return () => clearInterval(interval)
	}, [fetchNotifications])

	const handleClearAll = async () => {
		if (!confirm("Are you sure you want to clear all notifications?")) return
		await fetch("/api/notifications", { method: "DELETE" })
		setNotifications([])
	}

	const handleDelete = async (id: string) => {
		await fetch(`/api/notifications/${id}`, { method: "DELETE" })
		setNotifications((prev) => prev.filter((n) => n.id !== id))
	}

	const handleRespond = (_responseType: PayloadTemplateType, newPrefill: ResponsePrefill) => {
		setPrefill(newPrefill)
		// Force form to re-mount with new prefill values
		setFormKey((k) => k + 1)
		// Scroll to form
		formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
	}

	const handleSent = () => {
		setPrefill(undefined)
		void fetchNotifications()
	}

	const receivedCount = notifications.filter((n) => n.direction === "received").length
	const sentCount = notifications.filter((n) => n.direction === "sent").length

	return (
		<main className="min-h-screen">
			<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
				{/* Header */}
				<div className="mb-8">
					<h1 className="font-bold text-3xl text-gray-900">Mock COAR Notify Server</h1>
					<p className="mt-2 text-gray-600">
						Inbox URL:{" "}
						<code className="rounded bg-gray-100 px-2 py-1 text-sm">
							http://localhost:4001/api/inbox
						</code>
					</p>
				</div>

				<div className="grid gap-8 lg:grid-cols-3">
					{/* Send Notification Form */}
					<div className="lg:col-span-1" ref={formRef}>
						<SendNotificationForm key={formKey} onSent={handleSent} prefill={prefill} />
						{prefill && (
							<button
								type="button"
								onClick={() => {
									setPrefill(undefined)
									setFormKey((k) => k + 1)
								}}
								className="mt-2 w-full text-gray-500 text-sm hover:text-gray-700"
							>
								Clear pre-filled values
							</button>
						)}
					</div>

					{/* Notifications List */}
					<div className="lg:col-span-2">
						<div className="rounded-lg border border-gray-200 bg-white shadow-sm">
							{/* Header with filters */}
							<div className="flex items-center justify-between border-gray-200 border-b px-6 py-4">
								<div className="flex items-center gap-4">
									<h2 className="font-semibold text-lg">Notifications</h2>
									<div className="flex gap-1 rounded-lg bg-gray-100 p-1">
										<button
											type="button"
											onClick={() => setFilter("all")}
											className={`rounded-md px-3 py-1 font-medium text-sm transition-colors ${
												filter === "all"
													? "bg-white text-gray-900 shadow-sm"
													: "text-gray-600 hover:text-gray-900"
											}`}
										>
											All ({notifications.length})
										</button>
										<button
											type="button"
											onClick={() => setFilter("received")}
											className={`rounded-md px-3 py-1 font-medium text-sm transition-colors ${
												filter === "received"
													? "bg-white text-gray-900 shadow-sm"
													: "text-gray-600 hover:text-gray-900"
											}`}
										>
											Received ({receivedCount})
										</button>
										<button
											type="button"
											onClick={() => setFilter("sent")}
											className={`rounded-md px-3 py-1 font-medium text-sm transition-colors ${
												filter === "sent"
													? "bg-white text-gray-900 shadow-sm"
													: "text-gray-600 hover:text-gray-900"
											}`}
										>
											Sent ({sentCount})
										</button>
									</div>
								</div>
								{notifications.length > 0 && (
									<button
										type="button"
										onClick={handleClearAll}
										className="text-red-600 text-sm hover:text-red-800"
									>
										Clear All
									</button>
								)}
							</div>

							{/* Notifications */}
							<div className="divide-y divide-gray-100">
								{isLoading ? (
									<div className="px-6 py-12 text-center text-gray-500">
										Loading notifications...
									</div>
								) : notifications.length === 0 ? (
									<div className="px-6 py-12 text-center text-gray-500">
										No notifications yet. Send one or wait for incoming
										requests.
									</div>
								) : (
									notifications.map((notification, index) => (
										<NotificationCard
											key={notification.id}
											notification={notification}
											isLatest={index === 0}
											notifications={notifications}
											onDelete={() => handleDelete(notification.id)}
											onRespond={handleRespond}
										/>
									))
								)}
							</div>
						</div>
					</div>
				</div>
			</div>
		</main>
	)
}
