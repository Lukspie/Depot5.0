/**
 * WebSocket endpoint ws://<telematics>/ws?ticket=<JWT>.
 *
 * The upgrade is accepted only if
 *  1. the Origin header (sent by every browser) is one of ALLOWED_ORIGINS — CORS does not apply to
 *     WebSockets, so this check is done here explicitly, and
 *  2. the ticket from the app is valid and unused.
 * Otherwise the HTTP upgrade is answered with 403 / 401 and the socket is closed.
 *
 * Client -> server messages: {"type":"subscribe"|"unsubscribe","channels":["vehicles",...]}
 * Server -> client messages: {"type":"batch","events":[{channel,type,data}...]} (max 4×/s),
 *                            {"type":"hello","user":{...},"channels":[...]} after connecting.
 */

import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { CHANNELS, isChannel, type Hub } from "./hub.js";
import { TicketError, type TicketClaims, type TicketVerifier } from "./ticket.js";

export interface WsLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface WsDeps {
  hub: Hub;
  verifier: TicketVerifier;
  allowedOrigins: readonly string[];
  log: WsLogger;
  path?: string;
}

function reject(socket: Duplex, status: number, reason: string): void {
  socket.write(
    `HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${reason}\n`,
  );
  socket.destroy();
}

export function attachWebSocket(server: Server, deps: WsDeps): WebSocketServer {
  const path = deps.path ?? "/ws";
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== path) {
      reject(socket, 404, "Not Found");
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !deps.allowedOrigins.includes(origin)) {
      deps.log.warn({ origin }, "websocket rejected: origin not allowed");
      reject(socket, 403, "Forbidden");
      return;
    }
    const ticket = url.searchParams.get("ticket");
    if (!ticket) {
      reject(socket, 401, "Unauthorized");
      return;
    }
    deps.verifier.verify(ticket, { consume: true }).then(
      (claims) => {
        wss.handleUpgrade(req, socket, head, (ws) => {
          onConnection(ws, claims, deps);
        });
      },
      (err: unknown) => {
        deps.log.warn({ reason: err instanceof TicketError ? err.message : "error" }, "websocket rejected");
        reject(socket, 401, "Unauthorized");
      },
    );
  });

  // drop dead connections (laptop sleep, network loss)
  const alive = new WeakMap<WebSocket, boolean>();
  const pinger = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, 30_000);
  wss.on("connection", (ws) => {
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
  });
  wss.on("close", () => {
    clearInterval(pinger);
  });
  return wss;
}

function onConnection(ws: WebSocket, user: TicketClaims, deps: WsDeps): void {
  const client = deps.hub.addClient((msg) => {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  });
  deps.log.info({ user: user.name, role: user.role }, "websocket connected");
  ws.send(JSON.stringify({ type: "hello", user, channels: CHANNELS }));

  ws.on("message", (raw: Buffer) => {
    let msg: unknown;
    try {
      msg = JSON.parse(raw.toString("utf8"));
    } catch {
      ws.close(1003, "invalid json");
      return;
    }
    if (typeof msg !== "object" || msg === null) return;
    const { type, channels } = msg as { type?: unknown; channels?: unknown };
    const list = Array.isArray(channels) ? channels.filter(isChannel) : [];
    if (type === "subscribe") deps.hub.subscribe(client, list);
    else if (type === "unsubscribe") deps.hub.unsubscribe(client, list);
  });
  ws.on("close", () => {
    deps.hub.removeClient(client);
  });
}
