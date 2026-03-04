export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate environment for DB-only ETL jobs (no FMP API key needed).
 */
export function validateEnvironment(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!process.env.DATABASE_URL) {
    errors.push("Missing required environment variable: DATABASE_URL");
  }

  if (process.env.DATABASE_URL) {
    try {
      new URL(process.env.DATABASE_URL);
    } catch {
      errors.push("DATABASE_URL format is invalid");
    }
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Log validation result and exit if invalid.
 */
export function assertValidEnvironment(): void {
  const result = validateEnvironment();

  for (const warning of result.warnings) {
    console.warn(`Warning: ${warning}`);
  }

  if (!result.isValid) {
    for (const error of result.errors) {
      console.error(`Error: ${error}`);
    }
    process.exit(1);
  }
}
