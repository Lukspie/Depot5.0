/** Configuration read from environment variables (see .env.example). */

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface Config {
  port: number;
  logLevel: string;
  allowedOrigins: string[];
  db: DbConfig;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export function loadConfig(): Config {
  return {
    port: Number(optional("PORT", "8080")),
    logLevel: optional("LOG_LEVEL", "info"),
    allowedOrigins: optional("ALLOWED_ORIGINS", "http://localhost:8000")
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
    db: {
      host: optional("TELEMETRY_DB_HOST", "db-telemetry"),
      port: Number(optional("TELEMETRY_DB_PORT", "5432")),
      database: required("TELEMETRY_DB_NAME"),
      user: required("TELEMETRY_DB_USER"),
      password: required("TELEMETRY_DB_PASSWORD"),
    },
  };
}
