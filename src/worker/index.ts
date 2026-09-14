import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { counters } from "./db/schema";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/", (c) => c.json({ name: "Cloudflare?" }));

app.use("/api/*", async (c, next) => {
	c.header("Cache-Control", "no-store");
	await next();
});

app.get("/api/count", async (c) => {
	const db = drizzle(c.env.DB);
	const counter = await db.select().from(counters).where(eq(counters.id, 1)).get();
	return c.json({ count: counter?.value ?? 0 });
});

app.post("/api/count/increment", async (c) => {
	const db = drizzle(c.env.DB);
	// One SQL statement creates or increments the shared counter without lost updates.
	const counter = await db.insert(counters)
		.values({ id: 1, value: 1 })
		.onConflictDoUpdate({
			target: counters.id,
			set: { value: sql`${counters.value} + 1` },
		})
		.returning({ count: counters.value })
		.get();
	return c.json(counter);
});

app.onError((error, c) => {
	console.error(error);
	return c.json({ error: "Unable to access the counter. Please try again." }, 500);
});

export default app;
