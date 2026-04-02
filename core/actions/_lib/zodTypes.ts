import { z } from "zod"

class Markdown extends z.ZodString {
	static create = () =>
		new Markdown({
			typeName: "Markdown" as z.ZodFirstPartyTypeKind.ZodString,
			checks: [],
			coerce: false,
		})

	_parse(input: z.ParseInput): z.ParseReturnType<string> {
		return {
			status: "valid",
			value: input.data,
		}
	}
}

class StringWithTokens extends z.ZodString {
	static create = () =>
		new StringWithTokens({
			typeName: "StringWithTokens" as z.ZodFirstPartyTypeKind.ZodString,
			checks: [],
			coerce: false,
		})

	_parse(input: z.ParseInput): z.ParseReturnType<string> {
		return {
			status: "valid",
			value: input.data,
		}
	}
}

class FieldName extends z.ZodString {
	static create = () =>
		new FieldName({
			typeName: "FieldName" as z.ZodFirstPartyTypeKind.ZodString,
			checks: [],
			coerce: false,
		})
}

class Stage extends z.ZodString {
	static create = () =>
		new Stage({
			typeName: "Stage" as z.ZodFirstPartyTypeKind.ZodString,
			checks: [],
			coerce: false,
		})
}

class Member extends z.ZodString {
	static create = () =>
		new Member({
			typeName: "Member" as z.ZodFirstPartyTypeKind.ZodString,
			checks: [],
			coerce: false,
		})
}

class FormSlugType extends z.ZodString {
	static create = () =>
		new FormSlugType({
			typeName: "FormSlug" as z.ZodFirstPartyTypeKind.ZodString,
			checks: [],
			coerce: false,
		})
}

// @ts-expect-error FIXME:  'ZodObject<{ pubField: ZodString; responseField: ZodString; }, UnknownKeysParam, ZodTypeAny, { pubField: string; responseField: string; }, { pubField: string; responseField: string; }>' is assignable to the constraint of type 'El', but 'El' could be instantiated with a different subtype of constraint 'ZodTypeAny' blahblahblah
class OutputMap extends z.ZodArray<
	z.ZodObject<{ pubField: z.ZodString; responseField: z.ZodString }>
> {
	static create = () =>
		new OutputMap({
			typeName: "OutputMap" as z.ZodFirstPartyTypeKind.ZodArray,
			type: z.object({ pubField: z.string(), responseField: z.string() }),
			exactLength: null,
			minLength: null,
			maxLength: null,
			description: "",
		})
}

export const markdown = Markdown.create
export const stringWithTokens = StringWithTokens.create
export const fieldName = FieldName.create
export const stage = Stage.create
export const member = Member.create
export const formSlug = FormSlugType.create
export const outputMap = OutputMap.create

// custom typeName constants used for detecting reference fields during config rewriting
export const REFERENCE_TYPE_NAMES = {
	Stage: "Stage",
	Member: "Member",
	FormSlug: "FormSlug",
	FieldName: "FieldName",
} as const
