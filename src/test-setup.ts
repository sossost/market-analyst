/**
 * Vitest global setup — runs before each test file.
 * ETL jobs call process.exit() at the module top level, which would kill
 * the test runner. Stub it so tests can import those modules safely.
 */
import { vi } from "vitest";

vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
