import type { Page } from "@playwright/test"

import { LoginPage } from "./fixtures/login-page"

export const login = async (page: Page, email = "all@pubstar.org", password = "pubstar-all") => {
	const loginPage = new LoginPage(page)
	await loginPage.goto()
	await loginPage.loginAndWaitForNavigation(email, password)
}
