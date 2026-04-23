import { ZodError, z } from "zod"

import { actionSchema } from "db/public"

type FlagSchema = z.infer<typeof flagSchema>
type FlagName = FlagSchema[0]
type FlagArgs<F extends FlagName> = Extract<FlagSchema, [F, unknown]>[1]

class Flags {
	#flags
	constructor(flags: FlagSchema[]) {
		this.#flags = new Map(flags as [string, unknown][])
	}
	get<F extends FlagName>(flagName: F): FlagArgs<F> {
		return (this.#flags.get(flagName) ??
			flagSchema.parse([flagName, undefined])[1]) as FlagArgs<F>
	}
}

const flagStateToBoolean = (flagState: string, ctx: z.RefinementCtx) => {
	switch (flagState) {
		case "on":
		case "true":
			return true
		case "off":
		case "false":
			return false
	}
	ctx.addIssue({
		code: z.ZodIssueCode.custom,
		message: "Invalid flag state",
		fatal: true,
	})
	return z.NEVER
}

const flagSchema = z.union([
	z.tuple([
		z.literal("disabled-actions"),
		z
			.string()
			.optional()
			.transform((s) => (s ? s.split("+").map((a) => a.trim()) : []))
			.pipe(actionSchema.array()),
	]),
	z.tuple([
		z.literal("http-allowed-domains"),
		z
			.string()
			.optional()
			.transform((s) =>
				s
					? s
							.split("+")
							.map((domain) => domain.trim())
							.filter((domain) => domain.length > 0)
					: []
			)
			.pipe(z.string().array()),
	]),
	z.tuple([
		z.literal("invites"),
		z.string().transform(flagStateToBoolean).optional().default("on"),
	]),
	z.tuple([
		z.literal("uploads"),
		z.string().transform(flagStateToBoolean).optional().default("on"),
	]),
	z.tuple([
		z.literal("show-test-only-tools"),
		z.string().transform(flagStateToBoolean).optional().default("off"),
	]),
])

export const flagsSchema = z
	.string()
	.transform((s) => (s ? s.split(",") : []))
	.transform((flagStrings, ctx) => {
		const parsedFlags: FlagSchema[] = []
		for (const flagString of flagStrings) {
			if (flagString === "") {
				continue
			}
			try {
				const [flagName, flagArgs] = flagString.split(":")
				const parsedFlag = flagSchema.parse([flagName, flagArgs])
				parsedFlags.push(parsedFlag)
			} catch (error) {
				if (error instanceof ZodError) {
					error.issues.forEach(ctx.addIssue)
				}
			}
		}
		return new Flags(parsedFlags)
	})
	.optional()
