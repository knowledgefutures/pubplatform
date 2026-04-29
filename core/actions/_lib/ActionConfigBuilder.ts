import type { Action } from "db/public"
import type { ZodError, z } from "zod"

import { getActionByName } from "../api"
import { extractJsonata, needsInterpolation, schemaWithJsonFields } from "./schemaWithJsonFields"

// error codes for clear error handling
export enum ActionConfigErrorCode {
	ACTION_NOT_FOUND = "ACTION_NOT_FOUND",
	INVALID_RAW_CONFIG = "INVALID_RAW_CONFIG",
	INVALID_CONFIG_WITH_DEFAULTS = "INVALID_CONFIG_WITH_DEFAULTS",
	INTERPOLATION_FAILED = "INTERPOLATION_FAILED",
	INVALID_INTERPOLATED_CONFIG = "INVALID_INTERPOLATED_CONFIG",
}

export type ActionConfigError = {
	code: ActionConfigErrorCode
	message: string
	zodError?: ZodError
	cause?: unknown
}

export type ActionConfigSuccess<T = Record<string, unknown>> = {
	success: true
	config: T
}

export type ActionConfigResult<T = Record<string, unknown>> =
	| ActionConfigSuccess<T>
	| { success: false; error: ActionConfigError }

type BuilderState = "initial" | "validated" | "interpolated"

const collectActionFieldReferences = (obj: Record<string, unknown>): Record<string, string[]> => {
	const refMap = {} as Record<string, string[]>
	for (const [key, value] of Object.entries(obj)) {
		const refs: string[] = []
		if (typeof value === "string") {
			const valueJsonata = extractJsonata(value)
			const actionFieldMatches = valueJsonata.match(/(\$\.action\.config\.[a-zA-Z0-9_]+)/g)
			if (actionFieldMatches) {
				for (const match of actionFieldMatches) {
					refs.push(match.replace("$.action.config.", ""))
				}
			}
		}
		refMap[key] = refs
	}
	return refMap
}

const detectCycles = (graph: Record<string, string[]>): string[] => {
	const visited = new Set<string>()
	const stack = new Set<string>()
	const cycle: string[] = []

	const dfs = (node: string, path: string[]): boolean => {
		if (stack.has(node)) {
			const cycleStart = path.indexOf(node)
			cycle.push(...path.slice(cycleStart), node)
			return true
		}

		if (visited.has(node)) {
			return false
		}

		visited.add(node)
		stack.add(node)

		const nodeDependencies = graph[node] ?? []
		for (const nodeDependency of nodeDependencies) {
			if (nodeDependency in graph) {
				if (dfs(nodeDependency, [...path, node])) {
					return true
				}
			}
		}

		stack.delete(node)
		return false
	}

	for (const node of Object.keys(graph)) {
		if (!visited.has(node)) {
			if (dfs(node, [])) {
				break
			}
		}
	}

	return cycle
}

const reportCycle = (cycle: string[]): string => {
	let message = "Failed to evaluate configuration because "
	for (let i = 0; i < cycle.length - 1; i++) {
		message += i === 0 ? "" : "and "
		message += `$.action.config.${cycle[i]} uses $.action.config.${cycle[i + 1]}\n`
	}
	return message
}

/**
 * immutable builder for action configurations
 * handles validation, defaults, and interpolation with clear error codes
 *
 * each method returns a new instance, allowing for a functional, chainable api
 *
 * @example
 * ```ts
 * const result = await new ActionConfigBuilder(Action.http)
 *   .withDefaults({ method: 'GET' })
 *   .withConfig({ url: '{{ $.url }}' })
 *   .validate()
 *   .interpolate({ url: 'https://example.com' })
 *   .validate()
 *   .getResult();
 * ```
 */
export class ActionConfigBuilder<
	TConfig extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
> {
	private readonly actionName: Action
	private readonly action: ReturnType<typeof getActionByName>
	private readonly defaults: Record<string, unknown>
	private readonly config: Record<string, unknown>
	private readonly overrides: Record<string, unknown>
	private readonly state: BuilderState
	private readonly result: ActionConfigResult | null

	constructor(
		actionName: Action,
		options: {
			action?: ReturnType<typeof getActionByName> | null
			defaults?: Record<string, unknown>
			config?: Record<string, unknown>
			overrides?: Record<string, unknown>
			state?: BuilderState
			result?: ActionConfigResult | null
		} = {}
	) {
		this.actionName = actionName
		this.defaults = options.defaults ?? {}
		this.config = options.config ?? {}
		this.overrides = options.overrides ?? {}
		this.state = options.state ?? "initial"
		this.result = options.result ?? null

		if (options.action != null) {
			this.action = options.action
			return
		}

		// will throw if action not found
		this.action = getActionByName(actionName)
	}

	/**
	 * create new instance with default configuration values
	 * these will be merged with the lowest priority
	 */
	withDefaults(defaults: Record<string, unknown> | string[]): ActionConfigBuilder<TConfig> {
		if (Array.isArray(defaults)) {
			defaults = defaults.reduce(
				(acc, key) => {
					acc[key] = true
					return acc
				},
				{} as Record<string, true>
			)
		}
		return new ActionConfigBuilder(this.actionName, {
			action: this.action,
			defaults,
			config: this.config,
			overrides: this.overrides,
			state: this.state,
			result: this.result,
		})
	}

	/**
	 * create new instance with main configuration
	 * this typically comes from the action instance
	 */
	withConfig(config: Record<string, unknown>): ActionConfigBuilder<TConfig> {
		return new ActionConfigBuilder(this.actionName, {
			action: this.action,
			defaults: this.defaults,
			config,
			overrides: this.overrides,
			state: this.state,
			result: this.result,
		})
	}

	/**
	 * create new instance with override values
	 * these will be merged with the highest priority
	 */
	withOverrides(overrides: Record<string, unknown>): ActionConfigBuilder<TConfig> {
		return new ActionConfigBuilder(this.actionName, {
			action: this.action,
			defaults: this.defaults,
			config: this.config,
			overrides,
			state: this.state,
			result: this.result,
		})
	}

	/**
	 * validate the current configuration
	 *
	 * behavior depends on current state:
	 * - initial: validates raw config (allows templates)
	 * - validated: returns existing validation result
	 * - interpolated: validates interpolated config against original schema
	 */
	validate(): ActionConfigBuilder<TConfig> {
		if (this.result && !this.result.success) {
			return this
		}

		if (this.state === "validated" && this.result) {
			return this
		}

		if (this.state === "interpolated") {
			return this.validateInterpolated()
		}

		return this.validateRaw()
	}

	/**
	 * validate with defaults applied
	 * makes fields that have defaults optional
	 */
	validateWithDefaults(): ActionConfigBuilder<TConfig> {
		if (this.result && !this.result.success) {
			return this
		}

		const schema = this.getSchema()
		if (!schema) {
			return new ActionConfigBuilder(this.actionName, {
				action: this.action,
				defaults: this.defaults,
				config: this.config,
				overrides: this.overrides,
				state: this.state,
				result: {
					success: false,
					error: {
						code: ActionConfigErrorCode.ACTION_NOT_FOUND,
						message: `Action ${this.actionName} not found`,
					},
				},
			})
		}

		const schemaWithPartialDefaults = schema.partial(
			Object.keys(this.defaults ?? {}).reduce(
				(acc, key) => {
					acc[key] = true
					return acc
				},
				{} as Record<string, true>
			)
		)

		const mergedConfig = this.getMergedConfig()
		const parseResult = schemaWithPartialDefaults.safeParse(mergedConfig)

		if (!parseResult.success) {
			return new ActionConfigBuilder(this.actionName, {
				action: this.action,
				defaults: this.defaults,
				config: this.config,
				overrides: this.overrides,
				state: this.state,
				result: {
					success: false,
					error: {
						code: ActionConfigErrorCode.INVALID_CONFIG_WITH_DEFAULTS,
						message: "Invalid configuration with defaults",
						zodError: parseResult.error,
					},
				},
			})
		}

		return new ActionConfigBuilder(this.actionName, {
			action: this.action,
			defaults: this.defaults,
			config: this.config,
			overrides: this.overrides,
			state: "validated",
			result: { success: true, config: parseResult.data },
		})
	}

	/**
	 * interpolate json template strings with actual data
	 *
	 * @param data - data to use for interpolation (e.g., pub values, webhook data)
	 * @returns promise with new builder instance containing interpolated config
	 */
	async interpolate(data: unknown): Promise<ActionConfigBuilder<TConfig>> {
		if (this.result && !this.result.success) {
			return this
		}

		const configToInterpolate =
			this.result?.success && this.state === "validated"
				? this.result.config
				: this.getMergedConfig()

		const fieldReferences = collectActionFieldReferences(configToInterpolate)
		const cycle = detectCycles(fieldReferences)

		if (cycle.length > 0) {
			return this.clone({
				state: "interpolated",
				result: {
					success: false,
					error: {
						code: ActionConfigErrorCode.INTERPOLATION_FAILED,
						message: reportCycle(cycle),
					},
				},
			})
		}

		try {
			// to prevent this from being bundled into the main bundle, we import it here
			const { interpolate } = await import("@pubstar/json-interpolate")

			const interpolateValue = async (value: unknown, data: unknown): Promise<unknown> => {
				if (typeof value !== "string") {
					if (Array.isArray(value)) {
						return await Promise.all(value.map((item) => interpolateValue(item, data)))
					}
					if (typeof value === "object" && value !== null) {
						const result: Record<string, unknown> = {}
						for (const [key, val] of Object.entries(value)) {
							result[key] = await interpolateValue(val, data)
						}
						return result
					}
					return value
				}

				if (!needsInterpolation(value)) {
					return value
				}

				const valueJsonata = extractJsonata(value)
				return await interpolate(valueJsonata, data)
			}

			// interpolate each field individually (supporting nested objects/arrays)
			const interpolatedConfig: Record<string, unknown> = {}

			for (const [key, value] of Object.entries(configToInterpolate)) {
				if (this.action.config.interpolation?.exclude?.some((k) => k === key)) {
					interpolatedConfig[key] = value
					continue
				}

				interpolatedConfig[key] = await interpolateValue(value, data)
			}

			return new ActionConfigBuilder(this.actionName, {
				action: this.action,
				defaults: this.defaults,
				config: this.config,
				overrides: this.overrides,
				state: "interpolated",
				result: { success: true, config: interpolatedConfig },
			})
		} catch (error) {
			return new ActionConfigBuilder(this.actionName, {
				action: this.action,
				defaults: this.defaults,
				config: this.config,
				overrides: this.overrides,
				state: this.state,
				result: {
					success: false,
					error: {
						code: ActionConfigErrorCode.INTERPOLATION_FAILED,
						message: `Failed to interpolate configuration: ${error.message}`,
						cause: error,
					},
				},
			})
		}
	}

	/**
	 * get the action schema
	 * returns null if action not found
	 */
	getRawSchema(): z.ZodObject<z.ZodRawShape> {
		return this.action.config.schema
	}

	/**
	 * get the schema that accepts json template strings
	 * throws if action not found
	 */
	getSchema(): z.ZodObject<z.ZodRawShape> {
		const schema = this.getRawSchema()
		return schemaWithJsonFields(schema)
	}

	/**
	 * get the current merged config (before validation)
	 */
	getMergedConfig(): Record<string, unknown> {
		return {
			...this.defaults,
			...this.config,
			...this.overrides,
		}
	}

	/**
	 * get the current result
	 * returns the validation or interpolation result if available
	 */
	getResult(): ActionConfigResult {
		if (this.result) {
			return this.result
		}

		// if no result yet, return the merged config as success
		return { success: true, config: this.getMergedConfig() }
	}

	/**
	 * get the current config if successful, throw if error
	 * useful for when you know the config should be valid
	 */
	unwrap(): Record<string, unknown> {
		const result = this.getResult()
		if (!result.success) {
			throw new Error(
				`Cannot unwrap failed config: ${result.error.code} - ${result.error.message}`
			)
		}
		return result.config
	}

	/**
	 * get the current config if successful, return null if error
	 */
	unwrapOr(defaultValue: Record<string, unknown> | null = null): Record<string, unknown> | null {
		const result = this.getResult()
		return result.success ? result.config : defaultValue
	}

	/**
	 * check if the current state is successful
	 */
	isSuccess(): boolean {
		const result = this.getResult()
		return result.success
	}

	/**
	 * check if the current state is an error
	 */
	isError(): boolean {
		return !this.isSuccess()
	}

	/**
	 * get the current state
	 */
	getState(): BuilderState {
		return this.state
	}

	// private helper methods
	private clone({
		result,
		state,
	}: {
		state?: BuilderState
		result?: ActionConfigResult | null
	} = {}): ActionConfigBuilder<TConfig> {
		return new ActionConfigBuilder(this.actionName, {
			action: this.action,
			defaults: this.defaults,
			config: this.config,
			overrides: this.overrides,
			state: state ?? this.state,
			result: result ?? this.result,
		})
	}

	private validateRaw(): ActionConfigBuilder<TConfig> {
		const schema = this.getSchema()
		if (!schema) {
			return this.clone({
				result: {
					success: false,
					error: {
						code: ActionConfigErrorCode.ACTION_NOT_FOUND,
						message: `Action ${this.actionName} not found`,
					},
				},
			})
		}

		const mergedConfig = this.getMergedConfig()
		const parseResult = schema.safeParse(mergedConfig)

		if (!parseResult.success) {
			return this.clone({
				state: "validated",
				result: {
					success: false,
					error: {
						code: ActionConfigErrorCode.INVALID_RAW_CONFIG,
						message: "Invalid raw configuration",
						zodError: parseResult.error,
					},
				},
			})
		}

		return this.clone({
			state: "validated",
			result: { success: true, config: parseResult.data },
		})
	}

	private validateInterpolated(): ActionConfigBuilder<TConfig> {
		if (!this.result || !this.result.success || this.state !== "interpolated") {
			return this.clone({
				state: "interpolated",
				result: {
					success: false,
					error: {
						code: ActionConfigErrorCode.INTERPOLATION_FAILED,
						message: "No interpolated config available",
					},
				},
			})
		}

		const schema = this.getRawSchema()
		if (!schema) {
			return this.clone({
				state: "interpolated",
				result: {
					success: false,
					error: {
						code: ActionConfigErrorCode.ACTION_NOT_FOUND,
						message: `Action ${this.actionName} not found`,
					},
				},
			})
		}

		const parseResult = schema.safeParse(this.result.config)

		if (!parseResult.success) {
			return this.clone({
				state: "interpolated",
				result: {
					success: false,
					error: {
						code: ActionConfigErrorCode.INVALID_INTERPOLATED_CONFIG,
						message: "Invalid interpolated configuration",
						zodError: parseResult.error,
					},
				},
			})
		}

		return this.clone({ result: { success: true, config: parseResult.data } })
	}
}

/**
 * convenience function to create a builder
 */
export const createActionConfigBuilder = (actionName: Action) => {
	return new ActionConfigBuilder(actionName)
}
