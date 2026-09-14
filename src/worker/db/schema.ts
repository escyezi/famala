import { integer, sqliteTable } from "drizzle-orm/sqlite-core";

export const counters = sqliteTable("counters", {
	id: integer("id").primaryKey(),
	value: integer("value").notNull().default(0),
});
