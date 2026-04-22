import { redirect } from "next/navigation"

export const metadata = {
	title: "Communities",
}

export default function Page() {
	redirect("/superadmin")
}
