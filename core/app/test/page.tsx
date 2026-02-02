"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "ui/button"

export default function TestPage() {
	const [currentlyHighlighted, setCurrentlyHighlighted] = useState("1")

	// const [startHighlighting, setStartHighlighting] = useState(false)
	const [mode, _setMode] = useState<"move-through" | "single" | "focus">("move-through")

	const highlightingInterval = useRef<number | null>(null)

	useEffect(() => {
		// if (startHighlighting) {
		highlightingInterval.current = setInterval(() => {
			setCurrentlyHighlighted((prev) => (Number(prev) < 10 ? String(Number(prev) + 1) : "1"))
		}, 300) as unknown as number
		// return
		// }

		return () => {
			if (highlightingInterval.current) {
				clearInterval(highlightingInterval.current)
			}
		}
	}, [])

	const focusStyle = useMemo(() => {
		switch (mode) {
			case "move-through":
				return `
                #s${currentlyHighlighted} {
                    background: #ffff0040;
                }
            `
			case "single":
				return `
                #s${currentlyHighlighted} {
                    & > span.text {
                        background: #ffff0040;
                    }
                }
            `
			case "focus":
				return `
                #fragment {
                    background: #ffff0040;
                }
                #s${currentlyHighlighted} {
                    & > span.text {
                        text-decoration: underline;
                    }
                }
            `
			default:
				return `
                #fragment {
                    background: #ffff0040;
                }
            `
		}
	}, [mode, currentlyHighlighted])

	return (
		<div className="flex h-screen w-screen flex-col items-center justify-center gap-4">
			<style>{focusStyle}</style>
			<p id="fragment">
				<span id="s10">
					<span id="s9">
						<span id="s8">
							<span id="s7">
								<span id="s6">
									<span id="s5">
										<span id="s4">
											<span id="s3">
												<span id="s2">
													<span id="s1">This </span>
													<span className="text">is </span>
												</span>
												<span className="text">a </span>
											</span>
											<span className="text">sentence </span>
										</span>
										<span className="text">with </span>
									</span>
									<span className="text">a </span>
								</span>
								<span className="text">few </span>
							</span>
							<span className="text">words </span>
						</span>
						<span className="text">in </span>
					</span>
					<span className="text">it. </span>
				</span>
			</p>
			<div className="flex gap-2">
				<Button
					type="button"
					variant="outline"
					onClick={() =>
						_setMode((prev) =>
							prev === "single"
								? "move-through"
								: prev === "move-through"
									? "focus"
									: "single"
						)
					}
				>
					Mode: {mode}
				</Button>
			</div>
		</div>
	)
}
