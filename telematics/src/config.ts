/** Configuration read from environment variables (see .env.example). */

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface SimConfig {
  /** simulated seconds per real second */
  speed: number;
  /** first simulated day (YYYY-MM-DD); null = today */
  startDate: string | null;
  startTime: string;
  seed: number;
  /** guarantee one night-truck breakdown that triggers a cascade warning */
  forceCascade: boolean;
  degradedDevice: string | null;
  degradationHours: number;
  /** devices driven by real hardware/scripts (Phase 6) instead of the simulator */
  externalDevices: string[];
  /** rolling read rate below this = device "degraded" */
  degradedThreshold: number;
  /** SIM_CONTROLS_ENABLED=false (production): clock, reset, seed and device controls answer 403 */
  controlsEnabled: boolean;
}

export interface Config {
  port: number;
  logLevel: string;
  allowedOrigins: string[];
  db: DbConfig;
  serviceToken: string;
  wsTicketSecret: string;
  appInternalUrl: string;
  gateRetentionDays: number;
  snapshotDir: string;
  sim: SimConfig;
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

function list(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function loadConfig(): Config {
  const secret = required("WS_TICKET_SECRET");
  if (secret.length < 32) throw new Error("WS_TICKET_SECRET must have at least 32 characters");
  const startDate = optional("SIM_START_DATE", "");
  const degraded = optional("SIM_DEGRADED_DEVICE", "DOCK-SCN-02");
  return {
    port: Number(optional("PORT", "8080")),
    logLevel: optional("LOG_LEVEL", "info"),
    allowedOrigins: list(optional("ALLOWED_ORIGINS", "http://localhost:8000")),
    db: {
      host: optional("TELEMETRY_DB_HOST", "db-telemetry"),
      port: Number(optional("TELEMETRY_DB_PORT", "5432")),
      database: required("TELEMETRY_DB_NAME"),
      user: required("TELEMETRY_DB_USER"),
      password: required("TELEMETRY_DB_PASSWORD"),
    },
    serviceToken: required("SERVICE_TOKEN"),
    wsTicketSecret: secret,
    appInternalUrl: optional("APP_INTERNAL_URL", "http://app:8000"),
    gateRetentionDays: Number(optional("GATE_RETENTION_DAYS", "30")),
    snapshotDir: optional("SNAPSHOT_DIR", "/tmp/depotrack-snapshots"),
    sim: {
      speed: Number(optional("SIM_SPEED", "60")),
      startDate: startDate === "" ? null : startDate,
      startTime: optional("SIM_START_TIME", "15:00"),
      seed: Number(optional("SIM_RANDOM_SEED", "42")),
      forceCascade: optional("SIM_FORCE_CASCADE", "true") === "true",
      degradedDevice: degraded === "none" ? null : degraded,
      degradationHours: Number(optional("SIM_DEGRADATION_HOURS", "6")),
      externalDevices: list(optional("SIM_EXTERNAL_DEVICES", "")),
      degradedThreshold: Number(optional("DEVICE_DEGRADED_THRESHOLD", "0.92")),
      controlsEnabled: optional("SIM_CONTROLS_ENABLED", "true") !== "false",
    },
  };
}
