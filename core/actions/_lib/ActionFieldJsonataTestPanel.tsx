import type { ProcessedPub } from "contracts"
import type { Action as ActionEnum, PubsId, StagesId } from "db/public"
import type z from "zod"
import type { ActionFormContextContextValue } from "./ActionForm"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { interpolate } from "@pubstar/json-interpolate"
import { skipToken } from "@tanstack/react-query"
import { AlertCircle, CheckCircle2, Loader2, Play, Zap, ZapOff } from "lucide-react"
import { useWatch } from "react-hook-form"

import { Alert, AlertDescription } from "ui/alert"
import { Button } from "ui/button"
import { Label } from "ui/label"
import { useStages } from "ui/stages"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/tabs"
import { Textarea } from "ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip"
import { cn } from "utils"
import { tryCatch } from "utils/try-catch"

import { useCommunity } from "~/app/components/providers/CommunityProvider"
import { PubSearchSelect } from "~/app/components/pubs/PubSearchSelect"
import { client } from "~/lib/api"
import { getActionByName } from "../api"
import { useActionForm } from "./ActionForm"
import { buildInterpolationContext } from "./interpolationContext"
import { extractJsonata } from "./schemaWithJsonFields"

export type TestInputType = "current-pub" | "select-pub" | "json-blob"

function getDefaultTestInputType(
	contextType: string,
	pubId: PubsId | undefined,
	actionAccepts: readonly string[]
): TestInputType {
	if (contextType === "run" && pubId) {
		return "current-pub"
	}
	if (actionAccepts.includes("json")) {
		return "json-blob"
	}
	return "select-pub"
}

export function ActionFieldJsonataTestPanel(props: {
	actionName: ActionEnum
	configKey: string
	value: string
	pubId: PubsId | undefined
	contextType: ActionFormContextContextValue
	actionAccepts: readonly string[]
	stageId: StagesId | null
	mode?: "template" | "jsonata"
}) {
	const [inputType, setInputType] = useState<TestInputType>(() =>
		getDefaultTestInputType(props.contextType, props.pubId, props.actionAccepts)
	)
	const { form, path } = useActionForm()

	const action = getActionByName(props.actionName)
	const [selectedPubId, setSelectedPubId] = useState(props.pubId)
	const [jsonBlob, setJsonBlob] = useState("{}")
	const [autoEvaluate, setAutoEvaluate] = useState(true)

	const community = useCommunity()

	const [testResult, setTestResult] = useState<{
		status: "success" | "error" | "pending" | "ready" | "start" | "idle"
		interpolated?: unknown
		error?: {
			type: string
			message: string
			issues?: z.ZodIssue[]
		}
	}>({ status: "idle" })

	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

	const { data, isFetching } = client.pubs.get.useQuery({
		queryData: selectedPubId
			? {
					params: {
						communitySlug: community.slug,
						pubId: selectedPubId,
					},
					query: {
						depth: 3,
						withRelatedPubs: true,
						withPubType: true,
						withStage: true,
					},
				}
			: skipToken,
		initialData: undefined,
		queryKey: ["pubs", "getMany", community.id, selectedPubId],
	})

	// cleanup debounce timer on unmount
	useEffect(() => {
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}
		}
	}, [])

	const values = useWatch({ control: form.control, ...(path ? { name: path } : {}) })

	const valuesMinusCurrent = useMemo(() => {
		const { [props.configKey]: _, ...rest } = values

		return rest
	}, [values, props.configKey])

	const stages = useStages()
	const stage = stages.find((s) => s.id === props.stageId)

	const bodyWithAction = useMemo(() => {
		if (!data?.body && inputType !== "json-blob") {
			return null
		}

		const pubOrJson =
			inputType === "json-blob"
				? (() => {
						try {
							return { json: JSON.parse(jsonBlob) }
						} catch {
							return null
						}
					})()
				: data?.body
					? { pub: data.body as ProcessedPub }
					: null

		if (!pubOrJson) {
			return null
		}

		return buildInterpolationContext({
			community: {
				id: community.id,
				name: community.name,
				slug: community.slug,
				avatar: community.avatar,
			},
			stage,
			env: {
				PUBSTAR_URL: typeof window !== "undefined" ? window.location.origin : "",
			},
			useDummyValues: true,
			...pubOrJson,
		})
	}, [
		data?.body,
		inputType,
		jsonBlob,
		community,
		stage,
		action.name,
		valuesMinusCurrent,
		community.avatar,
	])

	const canTest = useMemo(() => {
		if (inputType === "current-pub") {
			return !!props.pubId
		}
		if (inputType === "select-pub") {
			return !!selectedPubId
		}
		if (inputType === "json-blob") {
			try {
				JSON.parse(jsonBlob)
				return true
			} catch {
				return false
			}
		}
		return false
	}, [inputType, jsonBlob, props.pubId, selectedPubId])

	const handleTest = useCallback(async () => {
		if (!bodyWithAction) {
			setTestResult({
				status: "error",
				error: {
					type: "unknown_error" as const,
					message: "No data available to test",
				},
			})
			return
		}

		const configShape = action.config.schema.shape as Record<string, z.ZodType<any>>

		if (!(props.configKey in configShape)) {
			setTestResult({
				status: "error",
				error: {
					type: "invalid_key" as const,
					message: `Key ${props.configKey} not found in action ${props.actionName}`,
				},
			})
			return
		}

		setTestResult({ status: "pending" })

		try {
			const extractedValue =
				props.mode === "jsonata" ? extractJsonata(props.value) : props.value
			const [interpolateError, interpolated] = await tryCatch(
				interpolate(extractedValue, bodyWithAction)
			)

			if (interpolateError) {
				let errorType: "jsonata_error" | "parse_error" | "syntax_error" | "unknown_error" =
					"unknown_error"
				if (interpolateError?.message.includes("expression")) {
					errorType = "jsonata_error"
				} else if (
					interpolateError?.message.includes("parse") ||
					interpolateError?.message.includes("JSON")
				) {
					errorType = "parse_error"
				} else if (interpolateError?.message.includes("unclosed interpolation")) {
					errorType = "syntax_error"
				}

				setTestResult({
					status: "error",
					error: {
						type: errorType,
						message: interpolateError.message,
					},
				})
				return
			}

			const parsedBody = configShape[props.configKey].safeParse(interpolated)
			if (!parsedBody.success) {
				setTestResult({
					status: "error",
					interpolated,
					error: {
						type: "validation_error" as const,
						message:
							"Interpolated correctly, but interpolated value does not match the expected type for this field",
						issues: parsedBody.error.issues,
					},
				})
				return
			}

			setTestResult({
				status: "success",
				interpolated: parsedBody.data,
			})
		} catch (error) {
			setTestResult({
				status: "error",
				error: {
					type: "unknown_error" as const,
					message: error instanceof Error ? error.message : String(error),
				},
			})
		}
	}, [
		bodyWithAction,
		action.config.schema,
		props.configKey,
		props.actionName,
		props.value,
		props.mode,
	])

	const showInputSelector = inputType !== "current-pub"

	// auto-evaluate with debouncing
	useEffect(() => {
		if (!autoEvaluate) {
			return
		}

		if (!canTest) {
			setTestResult({ status: "idle" })
			return
		}

		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current)
		}

		debounceTimerRef.current = setTimeout(() => {
			void handleTest()
		}, 500)

		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}
		}
	}, [autoEvaluate, canTest, handleTest])

	const tabCount =
		(props.pubId && props.contextType === "run" ? 1 : 0) +
		1 +
		(props.actionAccepts.includes("json") ? 1 : 0)

	return (
		<div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-2 transition-all duration-200">
			<div className="flex items-center justify-between">
				<Label className="font-medium text-gray-700 text-xs">Test result</Label>

				<div className="flex items-center gap-2">
					{!autoEvaluate && (
						<Button
							data-testid={`toggle-jsonata-test-button-${props.configKey}`}
							variant="outline"
							size="sm"
							type="button"
							onClick={handleTest}
							disabled={!canTest || isFetching || testResult.status === "pending"}
							className="w-full text-xs"
						>
							{testResult.status === "pending" || isFetching ? (
								<Loader2 className="h-3 w-3 animate-spin" />
							) : (
								<Play className="h-3 w-3" />
							)}
						</Button>
					)}
					<Tooltip delayDuration={300}>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setAutoEvaluate(!autoEvaluate)}
								className={cn(
									"h-7 gap-1.5 px-2 text-xs transition-colors",
									autoEvaluate
										? "text-amber-700 hover:bg-amber-50 hover:text-amber-800"
										: "text-muted-foreground hover:bg-gray-100 hover:text-gray-700"
								)}
							>
								{autoEvaluate ? <Zap size={12} /> : <ZapOff size={12} />}
								Auto
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							{autoEvaluate ? "Auto-evaluation enabled" : "Auto-evaluation disabled"}
						</TooltipContent>
					</Tooltip>
				</div>
			</div>

			{showInputSelector && (
				<InputSelector
					setSelectedPubId={setSelectedPubId}
					currentPubId={props.pubId}
					contextType={props.contextType}
					actionAccepts={props.actionAccepts}
					inputType={inputType}
					setInputType={setInputType}
					tabCount={tabCount}
					jsonBlob={jsonBlob}
					setJsonBlob={setJsonBlob}
				/>
			)}

			<div className="min-h-[60px] transition-all duration-200">
				{/* to make it easier for screen readers to understand the output */}
				{testResult.status === "pending" && (
					<div className="flex items-center justify-center py-4 text-muted-foreground text-xs">
						<Loader2 className="mr-2 h-3 w-3 animate-spin" />
						Evaluating...
					</div>
				)}

				{testResult.status === "idle" && (
					<div className="flex items-center justify-center py-4 text-gray-400 text-xs">
						{isFetching
							? "Loading Pub data..."
							: !canTest
								? props.actionAccepts.includes("pub")
									? "No Pub selected to test JSONata expression against"
									: "No test data provided"
								: "Waiting for input..."}
					</div>
				)}

				{testResult.status === "success" && testResult.interpolated !== undefined && (
					<Alert className="fade-in-50 animate-in border-green-200 bg-green-50 duration-200">
						<CheckCircle2 className="h-4 w-4 text-green-600" />
						<AlertDescription className="ml-2">
							<div className="font-medium text-green-900 text-xs">Success</div>
							<output
								htmlFor={props.configKey}
								aria-label="Success: JSONata test interpolated value"
							>
								<pre className="mt-2 max-h-[300px] overflow-auto whitespace-pre-wrap rounded-sm bg-background p-2 font-mono text-foreground text-xs">
									{JSON.stringify(testResult.interpolated, null, 2)}
								</pre>
							</output>
						</AlertDescription>
					</Alert>
				)}

				{testResult.status === "error" && testResult.error !== undefined && (
					<Alert className="fade-in-50 animate-in border-red-200 bg-red-50 duration-200">
						<AlertCircle className="h-4 w-4 text-red-600" />
						<AlertDescription className="ml-2">
							<div className="font-medium text-red-900 text-xs">
								{testResult.error.type === "jsonata_error" && "JSONata Error"}
								{testResult.error.type === "parse_error" && "Parse Error"}
								{testResult.error.type === "syntax_error" && "Syntax Error"}
								{testResult.error.type === "validation_error" && "Validation Error"}
								{testResult.error.type === "invalid_key" && "Configuration Error"}
								{testResult.error.type === "unknown_error" && "Error"}
							</div>
							<div className="mt-1 text-red-800 text-xs">
								{testResult.error.message}
							</div>
							{testResult.interpolated ? (
								<output
									htmlFor={props.configKey}
									aria-label="Error: JSONata test interpolated value"
								>
									<pre className="mt-2 max-h-[300px] overflow-auto whitespace-pre-wrap rounded-sm bg-white p-2 font-mono text-gray-900 text-xs">
										{JSON.stringify(testResult.interpolated, null, 2)}
									</pre>
								</output>
							) : null}
							{testResult.error.issues && testResult.error.issues.length > 0 && (
								<div className="mt-2 space-y-1">
									{testResult.error.issues.map((issue, idx) => (
										<div key={idx} className="text-red-700 text-xs">
											{issue.path?.length > 0 && (
												<span className="font-medium">
													{issue.path.join(".")}:{" "}
												</span>
											)}
											{issue.message}
										</div>
									))}
								</div>
							)}
						</AlertDescription>
					</Alert>
				)}
			</div>
		</div>
	)
}

export const InputSelector = (props: {
	setSelectedPubId: (pubId: PubsId | undefined) => void
	/* the id of the pub we are going to run the action on */
	currentPubId?: PubsId
	contextType: ActionFormContextContextValue
	actionAccepts: readonly string[]
	inputType: TestInputType
	setInputType: (inputType: TestInputType) => void
	tabCount: number
	jsonBlob: string
	setJsonBlob: (jsonBlob: string) => void
}) => {
	return (
		<div className="space-y-2">
			<Tabs
				value={props.inputType}
				onValueChange={(v) => {
					props.setInputType(v as TestInputType)
				}}
				className="w-full"
			>
				{props.tabCount > 1 && (
					<TabsList
						className={cn(
							"grid w-full",
							props.tabCount === 1 && "grid-cols-1",
							props.tabCount === 2 && "grid-cols-2",
							props.tabCount === 3 && "grid-cols-3"
						)}
					>
						{props.currentPubId && props.contextType === "run" && (
							<TabsTrigger value="current-pub" className="text-xs">
								Current pub
							</TabsTrigger>
						)}
						<TabsTrigger value="select-pub" className="text-xs">
							Select test Pub
						</TabsTrigger>
						{props.actionAccepts.includes("json") && (
							<TabsTrigger value="json-blob" className="text-xs">
								JSON blob
							</TabsTrigger>
						)}
					</TabsList>
				)}
				<TabsContent value="current-pub" className="mt-2">
					<p className="text-gray-600 text-xs">Test using the current pub context</p>
				</TabsContent>
				<TabsContent value="select-pub" className="mt-2 space-y-2">
					<div className="flex max-w-xs flex-col gap-2">
						<PubSearchSelect
							onSelectedPubsChange={(pubs) => {
								if (!pubs.length) {
									props.setSelectedPubId(undefined)
									return
								}
								props.setSelectedPubId(pubs[0].id)
							}}
							placeholder="Search for a Pub to test..."
						/>
					</div>
				</TabsContent>
				<TabsContent value="json-blob" className="mt-2 space-y-2">
					<Textarea
						placeholder='{"key": "value"}'
						value={props.jsonBlob}
						onChange={(e) => props.setJsonBlob(e.target.value)}
						className="min-h-[100px] font-mono text-xs"
					/>
				</TabsContent>
			</Tabs>
		</div>
	)
}
