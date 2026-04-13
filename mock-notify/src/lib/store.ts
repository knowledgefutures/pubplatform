/**
 * File-backed store for COAR Notify payloads.
 * Persists notifications to a JSON file so they survive Next.js hot-reloads
 * during development. The file is cleared on server start.
 */

import fs from "node:fs"
import path from "node:path"

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

export interface StoredNotification {
	id: string
	payload: CoarNotifyPayload
	direction: "received" | "sent"
	timestamp: string
	targetUrl?: string
	status?: "success" | "error"
	error?: string
}

const STORE_PATH = path.join(process.cwd(), ".notifications.json")

class NotificationStore {
	private read(): StoredNotification[] {
		try {
			const data = fs.readFileSync(STORE_PATH, "utf-8")
			return JSON.parse(data)
		} catch {
			return []
		}
	}

	private write(notifications: StoredNotification[]): void {
		fs.writeFileSync(STORE_PATH, JSON.stringify(notifications))
	}

	addReceived(payload: CoarNotifyPayload): StoredNotification {
		const notification: StoredNotification = {
			id: crypto.randomUUID(),
			payload,
			direction: "received",
			timestamp: new Date().toISOString(),
		}
		const notifications = this.read()
		notifications.unshift(notification)
		this.write(notifications)
		return notification
	}

	addSent(
		payload: CoarNotifyPayload,
		targetUrl: string,
		status: "success" | "error",
		error?: string
	): StoredNotification {
		const notification: StoredNotification = {
			id: crypto.randomUUID(),
			payload,
			direction: "sent",
			timestamp: new Date().toISOString(),
			targetUrl,
			status,
			error,
		}
		const notifications = this.read()
		notifications.unshift(notification)
		this.write(notifications)
		return notification
	}

	getAll(): StoredNotification[] {
		return this.read()
	}

	getReceived(): StoredNotification[] {
		return this.read().filter((n) => n.direction === "received")
	}

	getSent(): StoredNotification[] {
		return this.read().filter((n) => n.direction === "sent")
	}

	clear(): void {
		this.write([])
	}

	delete(id: string): boolean {
		const notifications = this.read()
		const index = notifications.findIndex((n) => n.id === id)
		if (index !== -1) {
			notifications.splice(index, 1)
			this.write(notifications)
			return true
		}
		return false
	}
}

// Singleton instance
export const notificationStore = new NotificationStore()
