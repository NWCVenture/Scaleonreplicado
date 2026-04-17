import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const requireSsl =
  process.env.NODE_ENV === "production" ||
  !!process.env.DATABASE_URL?.includes("sslmode=require");

const client = postgres(process.env.DATABASE_URL!, {
  ssl: requireSsl ? "require" : false,
});

export const db = drizzle(client, { schema });
