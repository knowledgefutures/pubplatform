const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
	"Access-Control-Allow-Headers": "*",
}

const content = `<div class="review-content">
	<p><strong>Summary:</strong> The methodology is sound and the results are compelling.
	We recommend minor revisions before acceptance.</p>
	<p><strong>Strengths:</strong> Clear writing, novel approach, reproducible methods.</p>
	<p><strong>Weaknesses:</strong> Limited sample size, needs more discussion of limitations.</p>
</div>`

export function GET() {
	return new Response(content, {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			...CORS_HEADERS,
		},
	})
}

export function OPTIONS() {
	return new Response(null, { status: 204, headers: CORS_HEADERS })
}
