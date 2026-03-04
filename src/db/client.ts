import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (connectionString == null || connectionString === "") {
  throw new Error("DATABASE_URL environment variable is required");
}

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 10,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 30000,
  statement_timeout: 120000,
  query_timeout: 120000,
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
