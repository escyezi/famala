// src/App.tsx

import { useEffect, useState } from "react";
import reactLogo from "./assets/react.svg";
import viteLogo from "/vite.svg";
import cloudflareLogo from "./assets/Cloudflare_Logo.svg";
import honoLogo from "./assets/hono.svg";
import "./App.css";

async function requestCount(path: string, options?: RequestInit): Promise<number> {
	const response = await fetch(path, { cache: "no-store", ...options });
	if (!response.ok) throw new Error("Unable to load or save the count. Please try again.");
	const data = await response.json() as { count: number };
	return data.count;
}

function App() {
	const [count, setCount] = useState<number | null>(null);
	const [countError, setCountError] = useState("");
	const [saving, setSaving] = useState(false);
	const [name, setName] = useState("unknown");

	useEffect(() => {
		const controller = new AbortController();
		requestCount("/api/count", { signal: controller.signal })
			.then(setCount)
			.catch((error: Error) => {
				if (!controller.signal.aborted) setCountError(error.message);
			});
		return () => controller.abort();
	}, []);

	async function incrementCount() {
		if (saving || count === null) return;
		setSaving(true);
		setCountError("");
		try {
			setCount(await requestCount("/api/count/increment", { method: "POST" }));
		} catch (error) {
			setCountError((error as Error).message);
		} finally {
			setSaving(false);
		}
	}

	async function reloadCount() {
		if (saving) return;
		setSaving(true);
		setCountError("");
		try {
			setCount(await requestCount("/api/count"));
		} catch (error) {
			setCountError((error as Error).message);
		} finally {
			setSaving(false);
		}
	}

	return (
		<>
			<div>
				<a href="https://vite.dev" target="_blank">
					<img src={viteLogo} className="logo" alt="Vite logo" />
				</a>
				<a href="https://react.dev" target="_blank">
					<img src={reactLogo} className="logo react" alt="React logo" />
				</a>
				<a href="https://hono.dev/" target="_blank">
					<img src={honoLogo} className="logo cloudflare" alt="Hono logo" />
				</a>
				<a href="https://workers.cloudflare.com/" target="_blank">
					<img
						src={cloudflareLogo}
						className="logo cloudflare"
						alt="Cloudflare logo"
					/>
				</a>
			</div>
			<h1>Vite + React + Hono + Cloudflare</h1>
			<div className="card">
				<button
					onClick={incrementCount}
					aria-label="increment"
					disabled={count === null || saving}
					aria-busy={(count === null && !countError) || saving}
				>
					{count === null ? (countError ? "Count unavailable" : "Loading count…") : `count is ${count}`}
				</button>
				{countError && (
					<p role="alert">
						{countError} <button onClick={reloadCount}>Reload count</button>
					</p>
				)}
				<p>
					Edit <code>src/App.tsx</code> and save to test HMR
				</p>
			</div>
			<div className="card">
				<button
					onClick={() => {
						fetch("/api/")
							.then((res) => res.json() as Promise<{ name: string }>)
							.then((data) => setName(data.name));
					}}
					aria-label="get name"
				>
					Name from API is: {name}
				</button>
				<p>
					Edit <code>worker/index.ts</code> to change the name
				</p>
			</div>
			<p className="read-the-docs">Click on the logos to learn more</p>
		</>
	);
}

export default App;
