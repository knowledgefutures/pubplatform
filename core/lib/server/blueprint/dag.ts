/**
 * generic topological sort over a directed acyclic graph.
 *
 * @param edges - map from node id to the ids of nodes it depends on
 * @returns node ids in an order where all dependencies come before dependents
 * @throws if the graph contains a cycle
 */
export const topoSort = (edges: Record<string, string[]>): string[] => {
	const visited = new Set<string>()
	const stack = new Set<string>()
	const result: string[] = []

	const visit = (node: string, path: string[]): void => {
		if (stack.has(node)) {
			const cycleStart = path.indexOf(node)
			const cycle = [...path.slice(cycleStart), node]
			throw new Error(
				`cycle detected: ${cycle.join(" -> ")}`
			)
		}

		if (visited.has(node)) return

		stack.add(node)
		for (const dep of edges[node] ?? []) {
			if (dep in edges) {
				visit(dep, [...path, node])
			}
		}
		stack.delete(node)

		visited.add(node)
		result.push(node)
	}

	for (const node of Object.keys(edges)) {
		if (!visited.has(node)) {
			visit(node, [])
		}
	}

	return result
}

/**
 * build a dependency graph for pubs based on their relation references.
 * returns an edges map suitable for `topoSort`.
 *
 * a pub depends on any pub it references via `ref` in its `relatedPubs`.
 */
export const buildPubDependencyGraph = (
	pubs: Record<string, { relatedPubs?: Record<string, Array<{ ref?: string }>> }>
): Record<string, string[]> => {
	const edges: Record<string, string[]> = {}

	for (const pubKey of Object.keys(pubs)) {
		const deps: string[] = []
		const pub = pubs[pubKey]
		if (pub.relatedPubs) {
			for (const relations of Object.values(pub.relatedPubs)) {
				for (const rel of relations) {
					if (rel.ref && rel.ref in pubs) {
						deps.push(rel.ref)
					}
				}
			}
		}
		edges[pubKey] = deps
	}

	return edges
}
