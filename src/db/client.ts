import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (connectionString == null || connectionString === "") {
  throw new Error("DATABASE_URL environment variable is required");
}

const sslConfig =
  process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: true }
    : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString,
  ssl: sslConfig,
  max: 10,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 30000,
  statement_timeout: 300000,
  query_timeout: 300000,
  allowExitOnIdle: false,
});

pool.on("error", (err) => {
  console.error("Unexpected database pool error:", {
    message: err.message,
    code: (err as NodeJS.ErrnoException).code,
  });
});

export const db = drizzle(pool);
export { pool };
