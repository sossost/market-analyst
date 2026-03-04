import { db } from "@/db/client";
import { symbols } from "@/db/schema/screener";

export async function ensureSymbol(sym: string): Promise<void> {
  try {
    await db.insert(symbols).values({ symbol: sym }).onConflictDoNothing();
  } catch {
    // Ignore — symbol likely already exists
  }
}
