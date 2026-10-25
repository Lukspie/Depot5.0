import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp } from "../src/app.js";
import { Hub } from "../src/ws/hub.js";
import { attachWebSocket } from "../src/ws/server.js";
import type { WebSocketServer } from "ws";
import { TicketVerifier } from "../src/ws/ticket.js";
import { SECRET, silentLog, ticket } from "./fixtures.js";

describe("ticket verification", () => {
  const verifier = new TicketVerifier(SECRET);

  it("accepts a valid ticket and returns the role", async () => {
    expect(await verifier.verify(await ticket("operator"), { consume: false })).toEqual({
      userId: "7",
      name: "tester",
      role: "operator",
    });
  });

  it("rejects expired, foreign-signed, wrong-audience and unknown-role tickets", async () => {
    await expect(verifier.verify(await ticket("admin", { expSeconds: -30 }), { consume: false })).rejects.toThrow(
      "ticket expired",
    );
    const otherKey = new TextEncoder().encode("another-secret-0123456789abcdef012345");
    await expect(verifier.verify(await ticket("admin", { secret: otherKey }), { consume: false })).rejects.toThrow();
    await expect(verifier.verify(await ticket("admin", { audience: "app" }), { consume: false })).rejects.toThrow();
    await expect(verifier.verify(await ticket("boss"), { consume: false })).rejects.toThrow("invalid role");
  });

  it("a WebSocket ticket can be used only once", async () => {
    const t = await ticket();
    await verifier.verify(t, { consume: true });
    await expect(verifier.verify(t, { consume: true })).rejects.toThrow("already used");
  });
});

describe("hub batching", () => {
  it("coalesces keyed events, queues plain ones and sends one batch per flush", () => {
    const hub = new Hub({ flushMs: 1_000_000, maxQueue: 3 });
    const sent: string[] = [];
    const client = hub.addClient((m) => sent.push(m));
    hub.setSnapshot("clock", () => [{ channel: "clock", type: "tick", data: { t: 0 } }]);
    hub.subscribe(client, ["clock", "devices"]);
    for (let i = 1; i <= 5; i++) hub.publish("clock", "tick", { t: i }, "clock");
    for (let i = 1; i <= 5; i++) hub.publish("devices", "scan", { n: i });
    hub.publish("vehicles", "position", { ignored: true }, "X"); // not subscribed
    hub.flush();
    expect(sent).toHaveLength(1);
    const batch = JSON.parse(sent[0] ?? "{}") as { events: { type: string; data: unknown }[]; dropped: number };
    expect(batch.events.filter((e) => e.type === "scan").map((e) => e.data)).toEqual([{ n: 3 }, { n: 4 }, { n: 5 }]);
    expect(batch.events.filter((e) => e.type === "tick").map((e) => e.data)).toEqual([{ t: 5 }]);
    expect(batch.dropped).toBe(3); // snapshot + 2 oldest scans fell out of the queue of 3
    hub.flush();
    expect(sent).toHaveLength(1); // nothing new -> nothing sent
  });
});

describe("WebSocket endpoint", () => {
  let app: FastifyInstance;
  let url: string;
  let wss: WebSocketServer;
  const hub = new Hub({ flushMs: 50 });

  beforeAll(async () => {
    app = await buildApp({
      logLevel: "silent",
      allowedOrigins: ["http://localhost:8000"],
      db: { ping: () => Promise.resolve(), close: () => Promise.resolve() },
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    wss = attachWebSocket(app.server, { hub, verifier: new TicketVerifier(SECRET), allowedOrigins: ["http://localhost:8000"], log: silentLog });
    hub.setSnapshot("clock", () => [{ channel: "clock", type: "tick", data: { localTime: "15:00" } }]);
    hub.start();
    url = `ws://127.0.0.1:${String((app.server.address() as AddressInfo).port)}/ws`;
  });

  afterAll(async () => {
    hub.stop();
    for (const c of wss.clients) c.terminate();
    wss.close();
    await app.close();
  });

  type Msg = { type: string; events?: { channel: string }[]; user?: { role: string } };

  function connect(
    query: string,
    origin = "http://localhost:8000",
  ): Promise<{ ws: WebSocket; status?: number; messages: Msg[] }> {
    return new Promise((resolve) => {
      const messages: Msg[] = [];
      const ws = new WebSocket(`${url}${query}`, { headers: { Origin: origin } });
      ws.on("message", (raw: Buffer) => {
        messages.push(JSON.parse(raw.toString("utf8")) as Msg);
      });
      ws.on("open", () => {
        resolve({ ws, messages });
      });
      ws.on("unexpected-response", (_req, res) => {
        resolve({ ws, status: res.statusCode ?? 0, messages });
      });
      ws.on("error", () => undefined);
    });
  }

  it("rejects a connection without a ticket (401)", async () => {
    expect((await connect("")).status).toBe(401);
  });

  it("rejects a foreign Origin even with a valid ticket (403)", async () => {
    expect((await connect(`?ticket=${await ticket()}`, "http://evil.example")).status).toBe(403);
  });

  it("accepts a valid ticket, sends hello and the channel snapshot", async () => {
    const t = await ticket("security");
    const { ws, status, messages } = await connect(`?ticket=${t}`);
    expect(status).toBeUndefined();
    ws.send(JSON.stringify({ type: "subscribe", channels: ["clock", "nonsense"] }));
    for (let i = 0; i < 40 && !messages.some((m) => m.type === "batch"); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(messages[0]?.type).toBe("hello");
    expect(messages[0]?.user?.role).toBe("security");
    expect(messages.find((m) => m.type === "batch")?.events?.[0]?.channel).toBe("clock");
    ws.close();

    // the same ticket cannot open a second connection
    expect((await connect(`?ticket=${t}`)).status).toBe(401);
  });
});
