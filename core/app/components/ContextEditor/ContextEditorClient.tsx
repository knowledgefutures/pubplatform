import type { ContextEditorProps, EditorDisplayMode, EditorPaneMode } from "context-editor"
import type { PubsId, PubTypes, PubTypesId } from "db/public"

import { useCallback, useMemo } from "react"
import dynamic from "next/dynamic"

import { Skeleton } from "ui/skeleton"

import { upload } from "../forms/actions"
import { ContextAtom } from "./AtomRenderer"

import "context-editor/style.css"

import { useDebouncedCallback } from "use-debounce"

import { client } from "~/lib/api"
import { useServerAction } from "~/lib/serverActions"
import { useCommunity } from "../providers/CommunityProvider"

const editorSkeleton = (
	<Skeleton className="h-[440px] w-full">
		<Skeleton className="h-14 w-full rounded-b-none" />
	</Skeleton>
)

const ContextEditor = dynamic(() => import("context-editor").then((mod) => mod.ContextEditor), {
	ssr: false,
	loading: () => editorSkeleton,
})

const EditorLayout = dynamic(() => import("context-editor").then((mod) => mod.EditorLayout), {
	ssr: false,
	loading: () => editorSkeleton,
})

export const ContextEditorClient = (
	props: {
		pubTypes: Pick<PubTypes, "id" | "name">[]
		pubId: PubsId
		pubTypeId: PubTypesId
		/** When true, wraps the editor in EditorLayout with fullscreen + preview controls. */
		withLayout?: boolean
		initialDisplay?: EditorDisplayMode
		initialPanes?: EditorPaneMode
		// Might be able to use more of this type in the future—for now, this component is a lil more stricty typed than context-editor
	} & Pick<
		ContextEditorProps,
		"onChange" | "initialDoc" | "className" | "disabled" | "hideMenu" | "getterRef"
	>
) => {
	const runUpload = useServerAction(upload)

	const community = useCommunity()
	const getPubs = useCallback(
		async (filter: string) => {
			const res = await client.pubs.getMany.query({
				query: {
					withValues: true,
					withPubType: true,
					withStage: true,
					limit: 10,
					depth: 2,
					search: filter,
				},
				params: {
					communitySlug: community.slug,
				},
			})

			if (res.status !== 200) {
				return []
			}

			return res.body ?? []
		},
		[community.slug]
	)

	const debouncedGetPubs = useDebouncedCallback(getPubs, 300)

	const signedUploadUrl = useCallback(
		(fileName: string) => {
			return runUpload(fileName, "temporary")
		},
		[runUpload]
	)

	const memoEditor = useMemo(() => {
		const sharedProps = {
			pubId: props.pubId,
			pubTypeId: props.pubTypeId,
			pubTypes: props.pubTypes,
			// debounce returns `undefined` at the beginning — safe to cast
			getPubs: debouncedGetPubs as ContextEditorProps["getPubs"],
			getPubById: () => ({}),
			atomRenderingComponent: ContextAtom,
			onChange: props.onChange,
			initialDoc: props.initialDoc,
			disabled: props.disabled,
			className: props.className,
			hideMenu: props.hideMenu,
			upload: signedUploadUrl,
			getterRef: props.getterRef,
		}
		if (props.withLayout) {
			return (
				<EditorLayout
					{...sharedProps}
					initialDisplay={props.initialDisplay}
					initialPanes={props.initialPanes}
				/>
			)
		}
		return <ContextEditor {...sharedProps} />
	}, [
		props.pubTypes,
		props.disabled,
		props.className,
		props.getterRef,
		props.hideMenu,
		props.initialDoc,
		props.onChange,
		props.pubId,
		props.pubTypeId,
		props.withLayout,
		props.initialDisplay,
		props.initialPanes,
		signedUploadUrl,
	])

	return memoEditor
}
