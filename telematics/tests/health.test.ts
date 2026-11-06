import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { Database } from "../src/db/pool.js";

const okDb: Database = { ping: () => Promise.resolve(), close: () => Promise.resolve() };
const downDb: Database = {
  ping: () => Promise.reject(new Error("connection refused")),
  close: () => Promise.resolve(),
};

let app: FastifyInstance | undefined;

async function make(db: Database): Promise<FastifyInstance> {
  app = await buildApp({ logLevel: "silent", allowedOrigins: ["http://localhost:8000"], db });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("system endpoints", () => {
  it("GET /hello identifies the service", async () => {
    const res = await (await make(okDb)).inject({ method: "GET", url: "/hello" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "telematics" });
  });

  it("GET /health is 200 when the DB answers", async () => {
    const res = await (await make(okDb)).inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", db: "ok" });
  });

  it("GET /health is 503 when the DB is down", async () => {
    const res = await (await make(downDb)).inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "error", db: "unreachable" });
  });

  it("CORS allows only configured origins", async () => {
    const a = await make(okDb);
    const allowed = await a.inject({
      method: "GET",
      url: "/hello",
      headers: { origin: "http://localhost:8000" },
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:8000");
    const denied = await a.inject({
      method: "GET",
      url: "/hello",
      headers: { origin: "http://evil.example" },
    });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
