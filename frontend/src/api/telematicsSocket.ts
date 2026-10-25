/**
 * One shared WebSocket connection to telematics.
 *
 * 1. ask the app for a short-lived ticket (POST /api/auth/ws-ticket, uses the session cookie)
 * 2. connect to ws://<telematics>/ws?ticket=…  (telematics checks Origin + ticket)
 * 3. subscribe to the channels components need; events arrive in batches (max 4×/s)
 * 4. on disconnect: reconnect with back-off and a NEW ticket (tickets are single-use)
 */

import { sendJson } from "./client";

export type Channel = "vehicles" | "devices" | "alerts" | "clock";
export type SocketStatus = "connecting" | "open" | "closed";

export interface WsEvent<T = unknown> {
  channel: Channel;
  type: string;
  data: T;
}

type Handler = (event: WsEvent) => void;

interface Ticket {
  ticket: string;
  expiresIn: number;
  wsUrl: string;
}

const BACKOFF_MS = [1000, 2000, 5000, 10_000];

export class TelematicsSocket {
  private ws: WebSocket | null = null;
  private readonly handlers = new Map<Channel, Set<Handler>>();
  private readonly statusListeners = new Set<(s: SocketStatus) => void>();
  private statusValue: SocketStatus = "closed";
  private attempt = 0;
  private retryTimer: number | undefined;
  private stopped = false;

  get status(): SocketStatus {
    return this.statusValue;
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.retryTimer);
    this.ws?.close(1000, "bye");
    this.ws = null;
    this.setStatus("closed");
  }

  onStatus(listener: (s: SocketStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Listen to a channel; the first listener subscribes, the last one unsubscribes. */
  on(channel: Channel, handler: Handler): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler);
    if (set.size === 1) this.send({ type: "subscribe", channels: [channel] });
    return () => {
      set.delete(handler);
      if (set.size === 0) this.send({ type: "unsubscribe", channels: [channel] });
    };
  }

  private send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private setStatus(s: SocketStatus): void {
    this.statusValue = s;
    for (const l of this.statusListeners) l(s);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.setStatus("connecting");
    let ticket: Ticket;
    try {
      ticket = await sendJson<Ticket>("POST", "/api/auth/ws-ticket");
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;
    const ws = new WebSocket(`${ticket.wsUrl}?ticket=${encodeURIComponent(ticket.ticket)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus("open");
      const channels = [...this.handlers].filter(([, set]) => set.size > 0).map(([ch]) => ch);
      if (channels.length > 0) this.send({ type: "subscribe", channels });
    };
    ws.onmessage = (msg: MessageEvent<string>) => {
      let parsed: { type: string; events?: WsEvent[] };
      try {
        parsed = JSON.parse(msg.data) as typeof parsed;
      } catch {
        return;
      }
      if (parsed.type !== "batch" || !parsed.events) return;
      for (const ev of parsed.events) {
        for (const h of this.handlers.get(ev.channel) ?? []) h(ev);
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (!this.stopped) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    this.setStatus("closed");
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 10_000;
    this.attempt++;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => void this.connect(), delay);
  }
}
