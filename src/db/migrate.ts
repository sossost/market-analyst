/**
 * Run migration SQL directly against the database.
 * Usage: npx tsx src/db/migrate.ts
 */
import "dotenv/config";
import { Pool } from "pg";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

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

  console.log(`Found ${files.length} migration file(s)`);

  for (const file of files) {
    console.log(`Running: ${file}`);
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
        // Skip "already exists" errors for idempotency
        if (pgErr.code === "42P07" || pgErr.code === "42710" || pgErr.code === "42701") {
          console.log(`  Skipped (already exists): ${statement.slice(0, 60)}...`);
          continue;
        }
        throw err;
      }
    }

    console.log(`  Done: ${file}`);
  }

  await pool.end();
  console.log("Migration complete.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
