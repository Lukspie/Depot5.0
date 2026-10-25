/**
 * Publish/subscribe hub for WebSocket clients.
 *
 * Events are not sent one by one: every client gets at most one message per flush interval
 * (250 ms = max 4×/s) containing a batch. Events with a coalescing key (vehicle position, device
 * status, clock) keep only the latest value per key; plain events (scans, alerts) are queued with
 * a cap so a slow browser cannot make the server run out of memory.
 */

export const CHANNELS = ["vehicles", "devices", "alerts", "clock"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface WsEvent {
  channel: Channel;
  type: string;
  data: unknown;
}

export interface HubClient {
  readonly id: number;
  readonly channels: ReadonlySet<Channel>;
}

interface ClientState extends HubClient {
  channels: Set<Channel>;
  send: (message: string) => void;
  latest: Map<string, WsEvent>;
  queue: WsEvent[];
  dropped: number;
}

export interface HubOptions {
  flushMs?: number;
  maxQueue?: number;
}

export function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && (CHANNELS as readonly string[]).includes(value);
}

export class Hub {
  private readonly clients = new Map<number, ClientState>();
  private readonly snapshots = new Map<Channel, () => WsEvent[]>();
  private nextId = 1;
  private timer: NodeJS.Timeout | undefined;
  readonly flushMs: number;
  private readonly maxQueue: number;

  constructor(opts: HubOptions = {}) {
    this.flushMs = opts.flushMs ?? 250;
    this.maxQueue = opts.maxQueue ?? 500;
  }

  get size(): number {
    return this.clients.size;
  }

  start(): void {
    this.timer ??= setInterval(() => {
      this.flush();
    }, this.flushMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Initial state sent to a client right after it subscribes to a channel. */
  setSnapshot(channel: Channel, provider: () => WsEvent[]): void {
    this.snapshots.set(channel, provider);
  }

  addClient(send: (message: string) => void): HubClient {
    const client: ClientState = {
      id: this.nextId++,
      channels: new Set(),
      send,
      latest: new Map(),
      queue: [],
      dropped: 0,
    };
    this.clients.set(client.id, client);
    return client;
  }

  removeClient(client: HubClient): void {
    this.clients.delete(client.id);
  }

  subscribe(client: HubClient, channels: Channel[]): void {
    const c = this.clients.get(client.id);
    if (!c) return;
    for (const ch of channels) {
      if (c.channels.has(ch)) continue;
      c.channels.add(ch);
      for (const ev of this.snapshots.get(ch)?.() ?? []) this.enqueue(c, ev, undefined);
    }
  }

  unsubscribe(client: HubClient, channels: Channel[]): void {
    const c = this.clients.get(client.id);
    if (!c) return;
    for (const ch of channels) c.channels.delete(ch);
  }

  /** `key`: events with the same key replace each other until the next flush. */
  publish(channel: Channel, type: string, data: unknown, key?: string): void {
    const ev: WsEvent = { channel, type, data };
    for (const c of this.clients.values()) {
      if (c.channels.has(channel)) this.enqueue(c, ev, key);
    }
  }

  flush(): void {
    for (const c of this.clients.values()) {
      if (c.latest.size === 0 && c.queue.length === 0) continue;
      const events = [...c.queue, ...c.latest.values()];
      const message: { type: "batch"; events: WsEvent[]; dropped?: number } = { type: "batch", events };
      if (c.dropped > 0) message.dropped = c.dropped;
      c.queue = [];
      c.latest.clear();
      c.dropped = 0;
      try {
        c.send(JSON.stringify(message));
      } catch {
        this.clients.delete(c.id);
      }
    }
  }

  private enqueue(c: ClientState, ev: WsEvent, key: string | undefined): void {
    if (key !== undefined) {
      c.latest.set(`${ev.channel}:${key}`, ev);
      return;
    }
    c.queue.push(ev);
    if (c.queue.length > this.maxQueue) {
      c.queue.shift();
      c.dropped++;
    }
  }
}
