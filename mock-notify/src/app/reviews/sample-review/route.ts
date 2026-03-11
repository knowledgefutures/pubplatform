const MOCK_BASE = "http://localhost:4001"
const REVIEW_URL = `${MOCK_BASE}/reviews/sample-review`

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
	"Access-Control-Allow-Headers": "*",
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Sample Review</title>
	<link rel="describedby" type="application/docmap+json" href="${REVIEW_URL}/docmap" />
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body {
			font-family: Georgia, 'Times New Roman', serif;
			background: #fdf6e3;
			color: #3c3226;
			line-height: 1.7;
		}
		.banner {
			background: #b45309;
			color: #fef3c7;
			padding: 0.5rem 1.5rem;
			font-size: 0.8rem;
			font-family: system-ui, sans-serif;
			letter-spacing: 0.05em;
			text-transform: uppercase;
		}
		article {
			max-width: 680px;
			margin: 2.5rem auto;
			padding: 0 1.5rem;
		}
		h1 {
			font-size: 1.75rem;
			color: #92400e;
			border-bottom: 2px solid #d97706;
			padding-bottom: 0.5rem;
			margin-bottom: 1.5rem;
		}
		h2 {
			font-size: 1.15rem;
			color: #92400e;
			margin: 1.5rem 0 0.5rem;
		}
		p { margin-bottom: 0.75rem; }
		ul { margin: 0.5rem 0 1rem 1.5rem; }
		li { margin-bottom: 0.35rem; }
		.meta {
			font-family: system-ui, sans-serif;
			font-size: 0.85rem;
			color: #78716c;
			margin-bottom: 1.5rem;
		}
	</style>
</head>
<body>
	<div class="banner">Mock Review Service &mdash; External Review Platform</div>
	<article>
		<h1>Sample Peer Review</h1>
		<p class="meta">Hosted by Mock Review Service &bull; COAR Notify Demo</p>
		<section>
			<h2>Summary</h2>
			<p>The methodology is sound and the results are compelling.
			We recommend minor revisions before acceptance.</p>
		</section>
		<section>
			<h2>Strengths</h2>
			<ul>
				<li>Clear writing and well-structured arguments</li>
				<li>Novel approach to the research question</li>
				<li>Reproducible methods with available data</li>
			</ul>
		</section>
		<section>
			<h2>Weaknesses</h2>
			<ul>
				<li>Limited sample size</li>
				<li>Needs more discussion of limitations</li>
			</ul>
		</section>
	</article>
</body>
</html>`

export function GET() {
	return new Response(html, {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			...CORS_HEADERS,
		},
	})
}

export function OPTIONS() {
	return new Response(null, { status: 204, headers: CORS_HEADERS })
}
