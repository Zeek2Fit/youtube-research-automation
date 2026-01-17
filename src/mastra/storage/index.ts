import { PostgresStore } from "@mastra/pg";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../../shared/schema";

// Create a single shared PostgreSQL storage instance
export const sharedPostgresStorage = new PostgresStore({
  connectionString:
    process.env.DATABASE_URL || "postgresql://localhost:5432/mastra",
});

// Create Drizzle database connection for direct queries
export const db = drizzle(
  postgres(process.env.DATABASE_URL || "postgresql://localhost:5432/mastra"),
  { schema }
);

export { schema };