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

  const dbUrl = process.env.DATABASE_URL;

  if (dbUrl == null) {
    errors.push("Missing required environment variable: DATABASE_URL");
  } else if (dbUrl === "") {
    errors.push("DATABASE_URL must not be empty");
  } else {
    try {
      new URL(dbUrl);
    } catch {
      errors.push("DATABASE_URL format is invalid");
    }
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Validate environment for API ETL jobs (DATABASE_URL + FMP_API_KEY + DATA_API).
 */
export function validateEnvironmentVariables(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const requiredEnvVars = ["DATABASE_URL", "FMP_API_KEY", "DATA_API"];

  for (const envVar of requiredEnvVars) {
    if (process.env[envVar] == null || process.env[envVar] === "") {
      errors.push(`Missing required environment variable: ${envVar}`);
    }
  }

  if (process.env.DATABASE_URL != null && process.env.DATABASE_URL !== "") {
    try {
      new URL(process.env.DATABASE_URL);
    } catch {
      errors.push("DATABASE_URL format is invalid");
    }
  }

  if (process.env.DATA_API != null && process.env.DATA_API !== "") {
    try {
      new URL(process.env.DATA_API);
    } catch {
      errors.push("DATA_API format is invalid");
    }
  }

  if (
    process.env.FMP_API_KEY != null &&
    process.env.FMP_API_KEY.length < 10
  ) {
    warnings.push("FMP_API_KEY seems too short — verify it is correct");
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Alias: DB-only environment validation (screener convention name).
 */
export const validateDatabaseOnlyEnvironment = validateEnvironment;

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

/**
 * Assert API environment and exit if invalid.
 */
export function assertValidApiEnvironment(): void {
  const result = validateEnvironmentVariables();

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

// --- Data validation functions ---

export function validateSymbolData(symbolData: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof symbolData.symbol !== "string" || symbolData.symbol === "") {
    errors.push("symbol is missing or not a string");
  }

  if (typeof symbolData.companyName !== "string" || symbolData.companyName === "") {
    warnings.push("companyName is missing");
  }

  if (
    typeof symbolData.symbol === "string" &&
    !/^[A-Z]{1,5}$/.test(symbolData.symbol)
  ) {
    warnings.push(`Unusual symbol format: ${symbolData.symbol}`);
  }

  if (
    symbolData.marketCap != null &&
    (isNaN(Number(symbolData.marketCap)) || Number(symbolData.marketCap) < 0)
  ) {
    warnings.push(`Invalid market cap: ${symbolData.marketCap}`);
  }

  return { isValid: errors.length === 0, errors, warnings };
}

export function validatePriceData(priceData: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof priceData.symbol !== "string" || priceData.symbol === "") {
    errors.push("symbol is missing or not a string");
  }
  if (typeof priceData.date !== "string" || priceData.date === "") {
    errors.push("date is missing or not a string");
  }

  const priceFields = ["open", "high", "low", "close"];
  for (const field of priceFields) {
    if (priceData[field] != null) {
      const value = Number(priceData[field]);
      if (isNaN(value) || value < 0) {
        errors.push(`Invalid ${field} price: ${priceData[field]}`);
      }
    }
  }

  const { open, high, low, close } = priceData;
  if (high != null && low != null) {
    const nHigh = Number(high);
    const nLow = Number(low);
    if (nHigh < nLow) {
      errors.push("high is less than low");
    }
    if (open != null && (Number(open) > nHigh || Number(open) < nLow)) {
      errors.push("open price is outside of high/low range");
    }
    if (close != null && (Number(close) > nHigh || Number(close) < nLow)) {
      errors.push("close price is outside of high/low range");
    }
  }

  if (
    typeof priceData.date === "string" &&
    !/^\d{4}-\d{2}-\d{2}$/.test(priceData.date)
  ) {
    errors.push(`Invalid date format: ${priceData.date}`);
  }

  if (priceData.volume != null) {
    const volume = Number(priceData.volume);
    if (isNaN(volume) || volume < 0) {
      warnings.push(`Invalid volume: ${priceData.volume}`);
    }
  }

  return { isValid: errors.length === 0, errors, warnings };
}

export function validateRatioData(ratioData: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof ratioData.symbol !== "string" || ratioData.symbol === "") {
    errors.push("symbol is missing or not a string");
  }
  if (typeof ratioData.periodEndDate !== "string" || ratioData.periodEndDate === "") {
    errors.push("periodEndDate is missing or not a string");
  }

  if (
    typeof ratioData.periodEndDate === "string" &&
    !/^\d{4}-\d{2}-\d{2}$/.test(ratioData.periodEndDate)
  ) {
    errors.push(`Invalid periodEndDate format: ${ratioData.periodEndDate}`);
  }

  return { isValid: errors.length === 0, errors, warnings };
}

export function validateMovingAverageData(maData: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof maData.symbol !== "string" || maData.symbol === "") {
    errors.push("symbol is missing or not a string");
  }
  if (typeof maData.date !== "string" || maData.date === "") {
    errors.push("date is missing or not a string");
  }

  const maFields = ["ma20", "ma50", "ma100", "ma200", "volMa30"];
  for (const field of maFields) {
    if (maData[field] != null) {
      const value = Number(maData[field]);
      if (isNaN(value) || value < 0) {
        errors.push(`Invalid ${field}: ${maData[field]}`);
      }
    }
  }

  return { isValid: errors.length === 0, errors, warnings };
}

export function validateBatchData(
  dataArray: Record<string, unknown>[],
  validator: (data: Record<string, unknown>) => ValidationResult,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let validCount = 0;
  let invalidCount = 0;

  for (let i = 0; i < dataArray.length; i++) {
    const result = validator(dataArray[i]);
    if (result.isValid) {
      validCount++;
    } else {
      invalidCount++;
      errors.push(`Item ${i + 1}: ${result.errors.join(", ")}`);
    }
    warnings.push(...result.warnings.map((w) => `Item ${i + 1}: ${w}`));
  }

  if (invalidCount > 0) {
    errors.push(`Batch: ${validCount}/${dataArray.length} valid, ${invalidCount} failed`);
  }

  return { isValid: errors.length === 0, errors, warnings };
}
