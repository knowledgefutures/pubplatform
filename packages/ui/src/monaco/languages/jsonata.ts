import type { Monaco } from "@monaco-editor/react"
import type { editor, languages } from "monaco-editor"
import type { JsonataContextSchema, JsonataPropertySchema, ValidationError } from "../types"

export const JSONATA_BUILTIN_FUNCTIONS = [
	// string functions
	"string",
	"length",
	"substring",
	"substringBefore",
	"substringAfter",
	"uppercase",
	"lowercase",
	"trim",
	"pad",
	"contains",
	"split",
	"join",
	"match",
	"replace",
	"eval",
	"base64encode",
	"base64decode",
	"encodeUrlComponent",
	"encodeUrl",
	"decodeUrlComponent",
	"decodeUrl",
	// numeric functions
	"number",
	"abs",
	"floor",
	"ceil",
	"round",
	"power",
	"sqrt",
	"random",
	"formatNumber",
	"formatBase",
	"formatInteger",
	"parseInteger",
	// aggregate functions
	"sum",
	"max",
	"min",
	"average",
	// boolean functions
	"boolean",
	"not",
	"exists",
	// array functions
	"count",
	"append",
	"sort",
	"reverse",
	"shuffle",
	"distinct",
	"zip",
	// object functions
	"keys",
	"values",
	"spread",
	"merge",
	"sift",
	"each",
	"error",
	"assert",
	"type",
	// date/time functions
	"now",
	"millis",
	"fromMillis",
	"toMillis",
	// higher order functions
	"map",
	"filter",
	"single",
	"reduce",
	"clone",
]

const JSONATA_OPERATORS = ["and", "or", "in"]

export const createJsonataLanguageDefinition = (): languages.IMonarchLanguage => ({
	defaultToken: "invalid",
	tokenPostfix: ".jsonata",

	keywords: JSONATA_OPERATORS,
	builtins: JSONATA_BUILTIN_FUNCTIONS,

	operators: [
		"=",
		">",
		"<",
		"!",
		"~",
		"?",
		":",
		"&",
		"|",
		"+",
		"-",
		"*",
		"/",
		"%",
		"^",
		"!=",
		"<=",
		">=",
		":=",
		"~>",
	],

	symbols: /[=><!~?:&|+\-*/^%]+/,

	escapes: /\\(?:[bfnrt"'\\]|u[0-9A-Fa-f]{4})/,

	tokenizer: {
		root: [
			{ include: "@whitespace" },

			// context variable ($)
			[/\$(?!\w)/, "variable.context"],

			// function calls ($functionName)
			[
				/\$([a-zA-Z_]\w*)/,
				{
					cases: {
						"@builtins": "function.builtin",
						"@default": "function.user",
					},
				},
			],

			// numbers
			[/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, "number"],

			// strings
			[/"/, "string", "@string_double"],
			[/'/, "string", "@string_single"],

			// backtick quoted identifiers
			[/`[^`]*`/, "identifier.quoted"],

			// identifiers and keywords
			[
				/[a-zA-Z_]\w*/,
				{
					cases: {
						"@keywords": "keyword",
						"@default": "identifier",
					},
				},
			],

			// brackets
			[/[{}()[\]]/, "@brackets"],

			// operators
			[
				/@symbols/,
				{
					cases: {
						"@operators": "operator",
						"@default": "",
					},
				},
			],

			// delimiters
			[/[;,.]/, "delimiter"],
		],

		whitespace: [[/[ \t\r\n]+/, "white"]],

		string_double: [
			[/[^\\"]+/, "string"],
			[/@escapes/, "string.escape"],
			[/\\./, "string.escape.invalid"],
			[/"/, "string", "@pop"],
		],

		string_single: [
			[/[^\\']+/, "string"],
			[/@escapes/, "string.escape"],
			[/\\./, "string.escape.invalid"],
			[/'/, "string", "@pop"],
		],
	},

	brackets: [
		{ open: "{", close: "}", token: "delimiter.curly" },
		{ open: "[", close: "]", token: "delimiter.square" },
		{ open: "(", close: ")", token: "delimiter.parenthesis" },
	],
})

export const defineJsonataThemes = (monaco: Monaco) => {
	monaco.editor.defineTheme("pubstar-light", {
		base: "vs",
		inherit: true,
		rules: [
			{ token: "variable.context", foreground: "c41a16", fontStyle: "bold" },
			{ token: "function.builtin", foreground: "0000ff" },
			{ token: "function.user", foreground: "795e26" },
			{ token: "identifier", foreground: "001080" },
			{ token: "identifier.quoted", foreground: "001080", fontStyle: "italic" },
			{ token: "keyword", foreground: "0000ff", fontStyle: "bold" },
			{ token: "string", foreground: "a31515" },
			{ token: "number", foreground: "098658" },
			{ token: "operator", foreground: "000000" },
		],
		colors: {},
	})

	monaco.editor.defineTheme("pubstar-dark", {
		base: "vs-dark",
		inherit: true,
		rules: [
			{ token: "variable.context", foreground: "ff7b72", fontStyle: "bold" },
			{ token: "function.builtin", foreground: "79c0ff" },
			{ token: "function.user", foreground: "d2a8ff" },
			{ token: "identifier", foreground: "c9d1d9" },
			{ token: "identifier.quoted", foreground: "c9d1d9", fontStyle: "italic" },
			{ token: "keyword", foreground: "ff7b72", fontStyle: "bold" },
			{ token: "string", foreground: "a5d6ff" },
			{ token: "number", foreground: "79c0ff" },
			{ token: "operator", foreground: "c9d1d9" },
		],
		colors: {},
	})
}

export const validateJsonata = async (value: string): Promise<ValidationError[]> => {
	if (!value.trim()) return []

	try {
		const jsonata = (await import("jsonata")).default
		jsonata(value)
		return []
	} catch (err: unknown) {
		const error = err as { message?: string; position?: number; token?: string }
		const position = error.position ?? 0
		const { line, column } = positionToLineColumn(value, position)

		return [
			{
				message: error.message ?? "Invalid JSONata expression",
				line,
				column,
				severity: "error",
			},
		]
	}
}

const positionToLineColumn = (text: string, position: number): { line: number; column: number } => {
	const lines = text.slice(0, position).split("\n")
	return {
		line: lines.length,
		column: (lines[lines.length - 1]?.length ?? 0) + 1,
	}
}

export const inferSchemaFromExample = (obj: unknown): JsonataPropertySchema => {
	if (obj === null) return { type: "null" }
	if (Array.isArray(obj)) {
		const itemSchema =
			obj.length > 0 ? inferSchemaFromExample(obj[0]) : { type: "any" as const }
		return { type: "array", items: itemSchema }
	}
	if (typeof obj === "object") {
		const properties: Record<string, JsonataPropertySchema> = {}
		for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
			properties[key] = inferSchemaFromExample(val)
		}
		return { type: "object", properties }
	}
	if (typeof obj === "string") return { type: "string" }
	if (typeof obj === "number") return { type: "number" }
	if (typeof obj === "boolean") return { type: "boolean" }
	return { type: "any" }
}

export const createJsonataCompletionProvider = (
	monaco: Monaco,
	contextSchema: JsonataContextSchema | undefined
): languages.CompletionItemProvider => ({
	triggerCharacters: ["$", "."],

	provideCompletionItems: (
		model: editor.ITextModel,
		position: { lineNumber: number; column: number }
	) => {
		const word = model.getWordUntilPosition(position)
		const range = {
			startLineNumber: position.lineNumber,
			endLineNumber: position.lineNumber,
			startColumn: word.startColumn,
			endColumn: word.endColumn,
		}

		const lineContent = model.getLineContent(position.lineNumber)
		const textBeforeCursor = lineContent.slice(0, position.column - 1)

		const suggestions: languages.CompletionItem[] = []

		// suggest built-in functions after $
		if (textBeforeCursor.endsWith("$")) {
			JSONATA_BUILTIN_FUNCTIONS.forEach((fn, index) => {
				suggestions.push({
					label: fn,
					kind: monaco.languages.CompletionItemKind.Function,
					insertText: `${fn}(\${1})`,
					insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
					detail: "Built-in function",
					sortText: String(index).padStart(3, "0"),
					range,
				})
			})
		}

		// suggest context properties after $. or after a property path
		if (contextSchema?.properties) {
			const pathMatch = textBeforeCursor.match(/\$\.([a-zA-Z_][\w.]*)?$/)
			if (pathMatch || textBeforeCursor.endsWith("$.")) {
				const pathParts = pathMatch?.[1]?.split(".").filter(Boolean) ?? []
				let currentSchema: JsonataPropertySchema | undefined = {
					type: "object",
					properties: contextSchema.properties,
				}

				for (const part of pathParts.slice(0, -1)) {
					if (currentSchema?.type === "object" && currentSchema.properties) {
						currentSchema = currentSchema.properties[part]
					} else if (currentSchema?.type === "array" && currentSchema.items) {
						currentSchema = currentSchema.items
						if (currentSchema?.type === "object" && currentSchema.properties) {
							currentSchema = currentSchema.properties[part]
						}
					} else {
						currentSchema = undefined
						break
					}
				}

				if (currentSchema?.type === "object" && currentSchema.properties) {
					const entries = Object.entries(currentSchema.properties)
					for (let i = 0; i < entries.length; i++) {
						const [key, prop] = entries[i]
						suggestions.push({
							label: key,
							kind: monaco.languages.CompletionItemKind.Property,
							insertText: key,
							detail: `${prop.type}${prop.description ? ` - ${prop.description}` : ""}`,
							sortText: String(i).padStart(3, "0"),
							range,
						})
					}
				}
			}
		}

		return { suggestions }
	},
})

export const createJsonataHoverProvider = (
	contextSchema: JsonataContextSchema | undefined
): languages.HoverProvider => ({
	provideHover: (model: editor.ITextModel, position: { lineNumber: number; column: number }) => {
		const word = model.getWordAtPosition(position)
		if (!word) return null

		const lineContent = model.getLineContent(position.lineNumber)

		// check if hovering over a built-in function
		const fnMatch = lineContent.match(new RegExp(`\\$${word.word}\\s*\\(`))
		if (fnMatch && JSONATA_BUILTIN_FUNCTIONS.includes(word.word)) {
			return {
				contents: [
					{ value: `**$${word.word}**` },
					{
						value: `Built-in JSONata function. [Documentation](https://docs.jsonata.org/string-functions#${word.word.toLowerCase()})`,
					},
				],
				range: {
					startLineNumber: position.lineNumber,
					endLineNumber: position.lineNumber,
					startColumn: word.startColumn,
					endColumn: word.endColumn,
				},
			}
		}

		// check if hovering over a context property
		if (contextSchema?.properties) {
			const pathMatch = lineContent.slice(0, word.endColumn).match(/\$\.([a-zA-Z_][\w.]*)$/)
			if (pathMatch) {
				const path = pathMatch[1]
				const parts = path.split(".")
				let schema: JsonataPropertySchema | undefined = {
					type: "object",
					properties: contextSchema.properties,
				}

				for (const part of parts) {
					if (schema?.type === "object" && schema.properties) {
						schema = schema.properties[part]
					} else if (schema?.type === "array" && schema.items) {
						schema = schema.items
						if (schema?.type === "object" && schema.properties) {
							schema = schema.properties[part]
						}
					} else {
						schema = undefined
						break
					}
				}

				if (schema) {
					const contents: { value: string }[] = [
						{ value: `**${parts[parts.length - 1]}**: \`${schema.type}\`` },
					]
					if (schema.description) {
						contents.push({ value: schema.description })
					}
					if (schema.type === "object" && schema.properties) {
						const props = Object.keys(schema.properties).slice(0, 5).join(", ")
						contents.push({
							value: `Properties: ${props}${Object.keys(schema.properties).length > 5 ? "..." : ""}`,
						})
					}

					return {
						contents,
						range: {
							startLineNumber: position.lineNumber,
							endLineNumber: position.lineNumber,
							startColumn: word.startColumn,
							endColumn: word.endColumn,
						},
					}
				}
			}
		}

		return null
	},
})
