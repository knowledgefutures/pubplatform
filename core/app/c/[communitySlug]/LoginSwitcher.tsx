import Link from "next/link"

import { Button } from "ui/button"
import { ChevronsUpDown, Layers, UserRoundCog } from "ui/icon"
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover"
import { Separator } from "ui/separator"
import { SidebarMenuButton } from "ui/sidebar"

import { getLoginData } from "~/lib/authentication/loginData"
import LogoutButton from "../../components/LogoutButton"
import { UserDisplay } from "./UserDisplay"

export default async function LoginSwitcher() {
	const { user } = await getLoginData()
	if (!user) {
		return null
	}
	return (
		<div className="borderp-2 flex w-max-[100%] flex-col gap-y-2 rounded-lg">
			<Popover>
				<PopoverTrigger asChild>
					<SidebarMenuButton
						className="flex h-fit items-center gap-x-2 p-2 py-1"
						aria-label="User menu"
						data-testid="user-menu-button"
						aria-haspopup="true"
					>
						<UserDisplay user={user} />
						<ChevronsUpDown
							size="16"
							className="group-data-[collapsible=icon]:hidden"
						/>
					</SidebarMenuButton>
				</PopoverTrigger>
				<PopoverContent side="right" className="p-0">
					<div className="flex flex-col items-start">
						<div className="p-2">
							<UserDisplay user={user} />
						</div>
						<Separator className="mx-1" />
						<Button
							variant="ghost"
							size="sm"
							asChild
							className="w-full justify-start gap-2 rounded-none"
						>
							<Link
								className="flex w-full items-center justify-start gap-2"
								href="/settings"
							>
								<UserRoundCog size="14" strokeWidth={1.5} />
								Settings
							</Link>
						</Button>
						{user.isSuperAdmin && (
							<Button
								variant="ghost"
								size="sm"
								asChild
								className="w-full justify-start gap-2 rounded-none"
							>
								<Link
									className="flex w-full items-center justify-start gap-2"
									href="/communities"
								>
									<Layers size="14" strokeWidth={1.5} />
									Communities
								</Link>
							</Button>
						)}
						<Separator className="mx-1" />
						<LogoutButton
							variant="ghost"
							className="w-full justify-start rounded-none"
						/>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	)
}
