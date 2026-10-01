import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema.ts";
import dotenv from "dotenv";

dotenv.config({ override: true });

// We use a local Turso file for dev, but this easily swaps to a cloud Turso URL!
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local-turso.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });
