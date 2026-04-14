import { useEffect, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import { useTheme } from "next-themes"
import { useFieldArray, useWatch } from "react-hook-form"

import { Button } from "ui/button"
import { FieldDescription, FieldLabel, FieldSet } from "ui/field"
import { Input } from "ui/input"
import { MonacoFormField } from "ui/monaco"
import { FieldOutputMap } from "ui/outputMap"
import { usePubFieldContext } from "ui/pubFields"
import { usePubTypeContext } from "ui/pubTypes"
import { QueryBuilder } from "ui/queryBuilder"

import { useServerAction } from "~/lib/serverActions"
import { ActionField } from "../_lib/ActionField"
import { useActionForm } from "../_lib/ActionForm"
import { DEFAULT_PAGE_TEMPLATE } from "./action"
import { previewResult } from "./formActions"

export default function BuildSiteActionForm() {
	const { form, path } = useActionForm()

	const pagesPath = path ? `${path}.pages` : "pages"

	const pubFields = usePubFieldContext()
	const pubTypes = usePubTypeContext()

	useEffect(() => {
		if (!form.getValues("outputMap")) {
			form.setValue("outputMap", [])
		}
	}, [form])

	const { append, remove } = useFieldArray({
		control: form.control,
		name: pagesPath,
	})

	const fields = useWatch({ control: form.control, name: pagesPath }) ?? []

	const { resolvedTheme } = useTheme()
	const theme = resolvedTheme as "light" | "dark"

	const handlePreview = useServerAction(previewResult)

	const {
		mutate: handlePreviewMutation,
		data: previewData,
		isPending: isPreviewPending,
		error: previewError,
	} = useMutation({
		mutationFn: handlePreview,
	})

	const [activePreviewIndex, setActivePreviewIndex] = useState<number | null>(null)

	const insertDefaultTemplate = (index: number) => {
		form.setValue(`${pagesPath}.${index}.transform`, DEFAULT_PAGE_TEMPLATE)
	}

	return (
		<FieldSet className="space-y-6">
			<div className="space-y-4">
				<ActionField
					name="subpath"
					label="Deployment Path"
					description="URL path for this build (e.g., 'v1' or '2024'). Defaults to a unique ID."
				/>
			</div>

			<div className="space-y-3">
				<FieldLabel>Page Groups</FieldLabel>
				<FieldDescription>
					Each group selects pubs with a filter and generates pages using a template
				</FieldDescription>

				{fields.map((_field: unknown, index: number) => (
					<div key={index} className="space-y-3 rounded-md border p-2">
						<div className="flex items-center justify-between">
							<span className="font-medium text-sm">Group {index + 1}</span>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="h-7 w-7"
								onClick={() => remove(index)}
							>
								<Trash2 size={14} />
							</Button>
						</div>

						<div>
							<FieldLabel className="text-xs">Filter</FieldLabel>
							<ActionField
								name={`pages.${index}.filter`}
								render={({ field }) => (
									<QueryBuilder
										value={field.value ?? ""}
										onChange={field.onChange}
										pubFields={pubFields}
										pubTypes={pubTypes}
										theme={theme}
										placeholder="e.g. $.pub.pubType.name = 'Article'"
									/>
								)}
							/>
						</div>

						<div>
							<FieldLabel className="text-xs">URL Slug</FieldLabel>
							<ActionField
								name={`pages.${index}.slug`}
								render={({ field }) => (
									<MonacoFormField
										field={field}
										language="jsonata"
										theme={theme}
										height="80px"
									/>
								)}
							/>
						</div>

						<div>
							<FieldLabel className="text-xs">File Extension</FieldLabel>
							<FieldDescription className="text-xs">
								Output file type. Only &quot;html&quot; pages are wrapped in an HTML
								shell.
							</FieldDescription>
							<ActionField
								name={`pages.${index}.extension`}
								render={({ field }) => (
									<Input
										{...field}
										value={field.value ?? "html"}
										placeholder="html"
										className="h-8 text-sm"
									/>
								)}
							/>
						</div>

						<div>
							<div className="mb-1 flex items-center justify-between">
								<FieldLabel className="text-xs">Content Template</FieldLabel>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-6 text-xs"
									onClick={() => insertDefaultTemplate(index)}
								>
									Insert default
								</Button>
							</div>
							<ActionField
								name={`pages.${index}.transform`}
								render={({ field }) => (
									<MonacoFormField
										field={field}
										language="jsonata"
										theme={theme}
										height="200px"
										expandedHeight="60vh"
									/>
								)}
							/>
						</div>

						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={isPreviewPending && activePreviewIndex === index}
							onClick={() => {
								setActivePreviewIndex(index)
								handlePreviewMutation({
									slug: fields[index]?.slug ?? "",
									filter: fields[index]?.filter ?? "",
									transform: fields[index]?.transform ?? "",
									automationRunId: form.getValues("automationRunId") ?? "",
								})
							}}
						>
							{isPreviewPending && activePreviewIndex === index
								? "Loading..."
								: "Preview"}
						</Button>

						{previewError && activePreviewIndex === index && (
							<p className="text-destructive text-sm">
								Error: {previewError.message}
							</p>
						)}
						{previewData && activePreviewIndex === index && "pubs" in previewData && (
							<div className="rounded border bg-muted/50 p-2">
								<p className="mb-1 text-muted-foreground text-xs">
									{previewData.pubs?.length ?? 0} pubs matched
								</p>
								<pre className="max-h-[150px] overflow-auto text-xs">
									{JSON.stringify(previewData.pubs, null, 2)}
								</pre>
							</div>
						)}
					</div>
				))}

				<Button
					variant="outline"
					type="button"
					size="sm"
					onClick={() =>
						append({
							filter: "",
							slug: "$.pub.id",
							transform: DEFAULT_PAGE_TEMPLATE,
							extension: "html",
						})
					}
				>
					<Plus size={14} className="mr-1" />
					Add Group
				</Button>
			</div>

			<ActionField
				name="outputMap"
				render={({ field }) => <FieldOutputMap form={form} fieldName={field.name} />}
			/>
		</FieldSet>
	)
}
