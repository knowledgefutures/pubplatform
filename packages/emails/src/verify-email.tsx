import * as React from "react"
import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Img,
	Link,
	Preview,
	Section,
	Tailwind,
	Text,
} from "@react-email/components"

interface VerifyEmailprops {
	firstName: string
	verifyEmailLink: string
	previewText?: string
}

export const VerifyEmail = ({
	firstName,
	verifyEmailLink,
	previewText = `Verify your email`,
}: VerifyEmailprops) => {
	const baseUrl = process.env.PUBSTAR_URL ? process.env.PUBSTAR_URL : ""

	return (
		<Html>
			<Head />
			<Preview>{previewText}</Preview>
			<Tailwind>
				<Body className="mx-auto my-auto bg-white font-sans">
					<Container className="mx-auto my-[40px] w-[465px] rounded border border-[#eaeaea] border-solid p-[20px]">
						<Section className="mt-[32px]">
							<Img
								src={`${baseUrl}/static/logo.svg`}
								width="40"
								height="40"
								alt="PubPub"
								className="mx-auto my-0"
							/>
						</Section>
						<Heading className="mx-0 my-[30px] p-0 text-center font-normal text-[24px] text-black">
							Verify your email
						</Heading>
						<Text className="text-[14px] text-black leading-[24px]">
							Hello {firstName},
						</Text>
						<Text className="text-[14px] text-black leading-[24px]">
							You can use the button below to verify your email. If you were not
							expecting this invitation, please reply to this email to get in touch
							with us.
						</Text>
						<Section className="mt-[32px] mb-[32px] text-center">
							<Button
								className="rounded bg-[#000000] px-4 py-3 text-center font-semibold text-[12px] text-white no-underline"
								href={verifyEmailLink}
							>
								Verify your email
							</Button>
						</Section>
						<Text className="text-[14px] text-black leading-[24px]">
							or copy and paste this URL into your browser:{" "}
							<Link href={verifyEmailLink} className="text-blue-600 no-underline">
								{verifyEmailLink}
							</Link>
						</Text>
						<Hr className="mx-0 my-[26px] w-full border border-[#eaeaea] border-solid" />
						<Text className="text-[#666666] text-[12px] leading-[24px]">
							If you were not expecting this invitation, please reply to this email to
							get in touch with us.
						</Text>
					</Container>
				</Body>
			</Tailwind>
		</Html>
	)
}
