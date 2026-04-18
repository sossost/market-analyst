/**
 * Run migration SQL directly against the database.
 * Usage: npx tsx src/db/migrate.ts
 */
import "dotenv/config";
import { Pool } from "pg";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { logger } from "@/lib/logger";

const TAG = "MIGRATE";

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString == null || connectionString === "") {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const pool = new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: process.env.NODE_ENV === "production",
    },
  });

  const migrationsDir = join(import.meta.dirname, "../../db/migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  logger.info(TAG, `Found ${files.length} migration file(s)`);

  for (const file of files) {
    logger.info(TAG, `Running: ${file}`);
    const sqlContent = readFileSync(join(migrationsDir, file), "utf-8");

    // Split on Drizzle's statement breakpoint marker
    const statements = sqlContent
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      try {
        await pool.query(statement);
      } catch (err) {
        const pgErr = err as { code?: string; message: string };
        // Skip "already exists" / "already applied" errors for idempotency
        // 42P07: duplicate table, 42710: duplicate object, 42701: duplicate column
        // 42P16: invalid table definition (e.g. multiple primary keys — PK already exists)
        // 42704: undefined object (e.g. DROP CONSTRAINT IF EXISTS — constraint already gone)
        const IDEMPOTENT_CODES = new Set(["42P07", "42710", "42701", "42P16", "42704"]);
        if (IDEMPOTENT_CODES.has(pgErr.code ?? "")) {
          logger.info(TAG, `Skipped (already exists): ${statement.slice(0, 60)}...`);
          continue;
        }
        throw err;
      }
    }

    logger.info(TAG, `Done: ${file}`);
  }

  await pool.end();
  logger.info(TAG, "Migration complete.");
}

migrate().catch((err) => {
  logger.error(TAG, `Migration failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
