import type { UsersId } from "db/public"
import type { CommunitySeedOutput } from "~/prisma/seed/createSeed"

import { expect, test } from "@playwright/test"

import { MemberRole } from "db/public"

import { createSeed } from "~/prisma/seed/createSeed"
import { seedCommunity } from "~/prisma/seed/seedCommunity"
import { LoginPage } from "./fixtures/login-page"
import { PasswordResetPage } from "./fixtures/password-reset-page"
import { inbucketClient } from "./helpers"

test.describe.configure({ mode: "serial" })

const id = crypto.randomUUID() as UsersId

const seed = createSeed({
	community: {
		name: "Test Community",
		slug: "test-community-1",
	},
	users: {
		admin: {
			password: "password",
			isSuperAdmin: true,
			role: MemberRole.admin,
		},
		user: {
			password: "password",
			role: MemberRole.editor,
		},
		user2: {
			password: "password",
			role: MemberRole.editor,
		},
		user3: {
			password: "password",
			role: MemberRole.editor,
		},
		user4: {
			id,
			password: "password",
			role: MemberRole.admin,
		},
	},
})
let community: CommunitySeedOutput<typeof seed>

const seed2 = createSeed({
	community: {
		name: "Test Community 2",
		slug: "test-community-2",
	},
	users: {
		user4: {
			id,
			existing: true,
			role: MemberRole.admin,
		},
	},
})
let _community2: CommunitySeedOutput<typeof seed2>

test.beforeAll(async ({ browser }) => {
	community = await seedCommunity(seed)
	_community2 = await seedCommunity(seed2)
})

test.describe("general auth", () => {
	test("Login with invalid credentials", async ({ page }) => {
		const loginPage = new LoginPage(page)
		await loginPage.goto()
		await loginPage.login(community.users.user.email, "incorrect-password")
		await page.getByText("Incorrect email or password", { exact: true }).waitFor()
	})
})

test.describe("Auth with lucia", () => {
	test("Login as a lucia user", async ({ page }) => {
		const loginPage = new LoginPage(page)
		await loginPage.goto()
		await loginPage.loginAndWaitForNavigation(community.users.user.email, "password")
	})

	test("Logout as a lucia user", async ({ page }) => {
		const loginPage = new LoginPage(page)
		await loginPage.goto()
		await loginPage.loginAndWaitForNavigation(community.users.user2.email, "password")

		const cookies = await page.context().cookies()
		expect(cookies.find((cookie) => cookie.name === "auth_session")).toBeTruthy()
		expect(
			cookies.find((cookie) =>
				["token", "refresh", "sb-access-token", "sb-refresh-token"].includes(cookie.name)
			)
		).toBeFalsy()

		await page.getByTestId("user-menu-button").waitFor()

		await page.getByTestId("user-menu-button").click()
		await page.getByRole("button", { name: "Logout" }).click()
		await page.waitForURL("/login")

		const cookiesAfterLogout = await page.context().cookies()
		expect(cookiesAfterLogout.find((cookie) => cookie.name === "session")).toBeFalsy()
	})

	test("Password reset flow for lucia user", async ({ page }) => {
		// through forgot form
		const passwordResetPage = new PasswordResetPage(page)
		await passwordResetPage.goTo()
		const email = community.users.user3.email
		const newPassword = "some-pubpub"
		await passwordResetPage.sendResetEmail(email)
		await passwordResetPage.goToUrlFromEmail(email)
		await passwordResetPage.setNewPassword(newPassword)
		await page.waitForURL("/login")

		// through settings
		await page.getByPlaceholder("name@example.com").click()
		await page.getByPlaceholder("name@example.com").fill(community.users.user3.email)
		await page.getByPlaceholder("name@example.com").press("Tab")
		await page.getByLabel("Password").fill("some-pubpub")
		await page.getByRole("button", { name: "Sign in" }).click()

		await page.waitForURL(/\/c\/.*\/stages/)
		await page.getByTestId("user-menu-button").click()
		await page.getByRole("link", { name: "Settings" }).last().click()
		await page.waitForURL("/settings")
		await page.getByRole("button", { name: "Reset" }).click()
		await expect(
			page.getByRole("listitem").filter({ hasText: "Password reset email sent" })
		).toHaveCount(1)

		const message2 = await (
			await inbucketClient.getMailbox(community.users.user3.email.split("@")[0])
		).getLatestMessage()

		const url2 = message2.message.body.text?.match(/http:\/\/.*reset/)?.[0]
		await message2.delete()

		if (!url2) {
			throw new Error("No url found!")
		}

		await page.goto(url2)

		await page.waitForURL("/reset")
		// if it timesout here, the token is wrong
		await page.getByRole("textbox").click({ timeout: 1000 })
		await page.getByRole("textbox").fill("pubstar-some")
		await page.getByRole("button", { name: "Set new password" }).click()
		await page.getByPlaceholder("name@example.com").click()
		await page.getByPlaceholder("name@example.com").fill(community.users.user3.email)
		await page.getByPlaceholder("name@example.com").press("Tab")
		await page.getByLabel("Password").fill("pubstar-some")
		await page.getByRole("button", { name: "Sign in" }).click()

		await page.waitForURL(/\/c\/.*\/stages/)
	})
})

test("Last visited community is remembered", async ({ page }) => {
	const testCommunity1Regex = /\/c\/test-community-1/
	const testCommunity2Regex = /\/c\/test-community-2/
	const loginPage = new LoginPage(page)

	// Login and visit default community
	await loginPage.goto()
	await loginPage.loginAndWaitForNavigation(community.users.user4.email, "password")
	await expect(page).toHaveURL(testCommunity1Regex)

	// Switch communities and logout
	await page.getByRole("button", { name: "Select a community" }).click()
	await page.getByRole("menuitem", { name: "Test Community 2" }).click()
	await page.waitForURL(testCommunity2Regex)
	await page.getByRole("button", { name: "User menu" }).click()
	await page.getByRole("button", { name: "Logout" }).click()
	await page.waitForURL("/login")

	await loginPage.loginAndWaitForNavigation(community.users.user4.email, "password")
	await page.waitForTimeout(1000)
	await expect(page).toHaveURL(testCommunity2Regex)
})
