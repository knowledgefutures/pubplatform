import type { CommunitiesId, UsersId } from "db/public"
import type { FullAutomation } from "db/types"
import type { AutomationValidationResult } from "~/lib/server/blueprint/validate"
import type { CommunityStage } from "~/lib/server/stages"

import { Card, CardContent, CardTitle } from "ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "ui/empty"
import { Bot } from "ui/icon"
import { ItemGroup } from "ui/item"

import { StagePanelCardHeader } from "../../editor/StagePanelCard"
import { AddAutomationButton } from "./AddAutomationButton"
import { StagePanelAutomation } from "./StagePanelAutomation"

type Props = {
	userId: UsersId
	stage: CommunityStage
	communityId: CommunitiesId
	automations: FullAutomation[]
	validationResults?: AutomationValidationResult[]
}

export const StagePanelAutomations = (props: Props) => {
	const getIssuesForAutomation = (automationId: string) =>
		props.validationResults?.find((r) => r.automationId === automationId)?.issues

	return (
		<Card className="h-full">
			<StagePanelCardHeader>
				<div className="flex items-center gap-2">
					<Bot size={16} />
					<CardTitle>Automations</CardTitle>
				</div>
				<AddAutomationButton />
			</StagePanelCardHeader>
			<CardContent>
				{props.automations.length > 0 ? (
					<ItemGroup className="gap-y-2 dark:[&>div]:bg-muted/50">
						{props.automations.map((automation) => (
							<StagePanelAutomation
								stageId={props.stage.id}
								communityId={props.stage.communityId as CommunitiesId}
								automation={automation}
								key={automation.id}
								validationIssues={getIssuesForAutomation(automation.id)}
							/>
						))}
					</ItemGroup>
				) : (
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<Bot size={16} />
							</EmptyMedia>
							<EmptyTitle>No automations</EmptyTitle>
							<EmptyDescription>Add an automation to get started</EmptyDescription>
						</EmptyHeader>
					</Empty>
				)}
			</CardContent>
		</Card>
	)
}
