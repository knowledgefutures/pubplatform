const MOCK_BASE = "http://localhost:4001"
const REVIEW_URL = `${MOCK_BASE}/reviews/sample-review`

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
	"Access-Control-Allow-Headers": "*",
}

const docmap = {
	"@context": "https://w3id.org/docmaps/context.jsonld",
	type: "docmap",
	id: `${REVIEW_URL}/docmap`,
	publisher: {
		name: "Mock Review Service",
	},
	"first-step": "_:b0",
	steps: {
		"_:b0": {
			actions: [
				{
					outputs: [
						{
							type: "review-article",
							content: [
								{
									type: "web-page",
									url: REVIEW_URL,
								},
								{
									type: "web-content",
									url: `${REVIEW_URL}/content`,
								},
							],
						},
					],
				},
			],
		},
	},
}

export function GET() {
	return Response.json(docmap, {
		headers: CORS_HEADERS,
	})
}

export function OPTIONS() {
	return new Response(null, { status: 204, headers: CORS_HEADERS })
}
