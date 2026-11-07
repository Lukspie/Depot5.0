import { describe, expect, it } from "vitest";
import type { DbConfig } from "../src/config.js";
import { dbLocation, poolConfig } from "../src/db/pool.js";

/** db-telemetry in Azure or locally (ADR-056). */

const local: DbConfig = { url: null, host: "db-telemetry", port: 5432, database: "t", user: "u", password: "p" };
const azure = (query: string): DbConfig => ({
  url: `postgres://telematics:s%40cret@dp-telemetry.postgres.database.azure.com:5432/depotrack_telemetry${query}`,
  host: "dp-telemetry.postgres.database.azure.com",
  port: 5432,
  database: "",
  user: "",
  password: "",
});

describe("db-telemetry connection", () => {
  it("local container: host fields, no TLS", () => {
    expect(poolConfig(local)).toMatchObject({ host: "db-telemetry", database: "t", user: "u" });
    expect(dbLocation(local)).toEqual({ kind: "local", host: "db-telemetry", ssl: false });
  });

  it("Azure with sslmode=require: TLS with a verified certificate, sslmode not left in the URL", () => {
    const cfg = poolConfig(azure("?sslmode=require"));
    expect(cfg.ssl).toEqual({ rejectUnauthorized: true });
    expect(cfg.connectionString).not.toContain("sslmode");
    expect(cfg.connectionString).toContain("s%40cret@dp-telemetry");
    expect(dbLocation(azure("?sslmode=require"))).toEqual({ kind: "azure", host: "dp-telemetry.postgres.database.azure.com", ssl: true });
  });

  it("Azure without sslmode still uses TLS; no-verify encrypts without the CA check; disable is plain", () => {
    expect(poolConfig(azure("")).ssl).toEqual({ rejectUnauthorized: true });
    expect(poolConfig(azure("?sslmode=no-verify")).ssl).toEqual({ rejectUnauthorized: false });
    expect(poolConfig(azure("?sslmode=disable")).ssl).toBe(false);
  });
});

describe("TELEMETRY_DATABASE_URL validation", () => {
  it("rejects a malformed URL without leaking it (the password is in it)", async () => {
    const { checkDbUrl } = await import("../src/config.js");
    const bad = "postgres://telematics:s3cret#x@<server>.postgres.database.azure.com/db";
    let message = "";
    try {
      checkDbUrl(bad);
    } catch (err) {
      message = String(err);
    }
    expect(message).toContain("TELEMETRY_DATABASE_URL is not a valid URL");
    expect(message).not.toContain("s3cret");
    expect(() => { checkDbUrl("postgres://u:p%40ss@h.postgres.database.azure.com:5432/db?sslmode=require"); }).not.toThrow();
  });
});
