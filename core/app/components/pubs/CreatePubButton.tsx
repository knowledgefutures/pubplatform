import type { CommunitiesId, PubsId, PubTypesId, StagesId } from "db/public"
import type { ButtonProps } from "ui/button"
import type { PubTypeWithForm } from "~/lib/authorization/capabilities"

import { Suspense } from "react"
import { Star } from "lucide-react"

import { getLoginData } from "~/lib/authentication/loginData"
import { getCreatablePubTypes } from "~/lib/authorization/capabilities"
import { findCommunityBySlug } from "~/lib/server/community"
import { getPubFields } from "~/lib/server/pubFields"
import { ContextEditorContextProvider } from "../ContextEditor/ContextEditorContext"
import { PathAwareDialog } from "../PathAwareDialog"
import { SkeletonButton } from "../skeletons/SkeletonButton"
import { InitialCreatePubForm } from "./InitialCreatePubForm"

type RelatedPubData = {
	pubId: PubsId
	pubTypeId: PubTypesId
}

/**
 * Wrapper around InitialCreatePubForm which includes queries for everything that might
 * be needed for adding a related pub value
 */
const InitialCreatePubFormWithRelatedPub = async ({
	relatedPub,
	pubTypes,
	communityId,
	stageId,
}: {
	relatedPub: RelatedPubData
	pubTypes: PubTypeWithForm
	communityId: CommunitiesId
	stageId?: StagesId
}) => {
	const [pubFieldsResponse] = await Promise.all([
		//TODO: this includes all relationship fields on the pub type, but it should be limited to
		//relationship pub fields in the forms the user is allowed to use to create pubs of the
		//given type
		getPubFields({
			pubTypeId: relatedPub.pubTypeId,
			communityId: communityId,
			isRelated: true,
		}).executeTakeFirstOrThrow(),
	])

	const pubFields = Object.values(pubFieldsResponse.fields)

	return (
		<ContextEditorContextProvider
			pubId={relatedPub.pubId}
			pubTypes={pubTypes}
			pubTypeId={relatedPub.pubTypeId}
		>
			<InitialCreatePubForm
				pubTypes={pubTypes}
				relatedPubFields={pubFields}
				stageId={stageId}
				relatedPubId={relatedPub.pubId}
			/>
		</ContextEditorContextProvider>
	)
}

type Props = {
	variant?: ButtonProps["variant"]
	size?: ButtonProps["size"]
	className?: string
	text?: string
	/**
	 * If specified, pubs created via this button will be related to this relatedPub.pubId
	 * The relatedPub.pubId will gain a pub value that relates it to the newly created pub
	 */
	relatedPub?: RelatedPubData
} & (
	| {
			/** If specified, the pub editor will default to this stage */
			stageId: StagesId
	  }
	| { communityId: CommunitiesId }
)

export const CreatePubButton = async (props: Props) => {
	const id = "stageId" in props ? props.stageId : props.communityId

	const [community, { user }] = await Promise.all([findCommunityBySlug(), getLoginData()])

	if (!community) {
		return null
	}

	if (!user) {
		return null
	}

	const pubTypes = await getCreatablePubTypes(user.id, community.id)

	if (pubTypes.length === 0) {
		return null
	}

	const stageId = "stageId" in props ? props.stageId : undefined

	return (
		<PathAwareDialog
			buttonSize={props.size}
			buttonText={props.text ?? "Create"}
			buttonVariant={props.variant}
			className={props.className}
			icon={<Star size="12" className="mb-0.5" />}
			id={id}
			param="create-pub-form"
			title="Create Pub"
			disabled={pubTypes.length === 0}
		>
			{props.relatedPub ? (
				<InitialCreatePubFormWithRelatedPub
					pubTypes={pubTypes}
					relatedPub={props.relatedPub}
					communityId={community.id}
					stageId={stageId}
				/>
			) : (
				<InitialCreatePubForm pubTypes={pubTypes} relatedPubFields={[]} stageId={stageId} />
			)}
		</PathAwareDialog>
	)
}

export const MainCreatePubButton = (props: Props) => {
	return (
		<Suspense fallback={<SkeletonButton className="w-20" />}>
			<CreatePubButton {...props} variant="create" />
		</Suspense>
	)
}
