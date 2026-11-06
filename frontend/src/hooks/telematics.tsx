import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { TelematicsSocket, type Channel, type SocketStatus, type WsEvent } from "../api/telematicsSocket";

const SocketContext = createContext<TelematicsSocket | null>(null);

/** One WebSocket for the whole logged-in app (mounted inside the authenticated layout). */
export function TelematicsProvider({ children }: { children: ReactNode }) {
  const [socket] = useState(() => new TelematicsSocket());
  useEffect(() => {
    socket.start();
    return () => {
      socket.stop();
    };
  }, [socket]);
  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

function useSocket(): TelematicsSocket {
  const socket = useContext(SocketContext);
  if (!socket) throw new Error("useSocket outside TelematicsProvider");
  return socket;
}

export function useSocketStatus(): SocketStatus {
  const socket = useSocket();
  const [status, setStatus] = useState(socket.status);
  useEffect(() => socket.onStatus(setStatus), [socket]);
  return status;
}

/** Call `handler` for every event on `channel` (the latest handler is always used). */
export function useChannel<T>(channel: Channel, handler: (event: WsEvent<T>) => void): void {
  const socket = useSocket();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => socket.on(channel, (ev) => ref.current(ev as WsEvent<T>)), [socket, channel]);
}

export interface SimClockInfo {
  simTime: string;
  localTime: string;
  timeZone: string;
  operatingDay: string;
  speed: number;
  paused: boolean;
  seed: number;
  /** false when SIM_CONTROLS_ENABLED=false (ADR-053) */
  controlsEnabled?: boolean;
  /** loaded situation (ADR-054) */
  situation?: string | null;
}

/**
 * Simulated clock from the "clock" channel. Between server ticks (1 s) the time is advanced
 * locally by `speed`, so the display runs smoothly.
 */
export function useSimClock(): { info: SimClockInfo | null; now: Date | null } {
  const [info, setInfo] = useState<{ clock: SimClockInfo; receivedAt: number } | null>(null);
  const [realNow, setRealNow] = useState(() => Date.now());
  useChannel<SimClockInfo>("clock", (ev) => {
    setInfo({ clock: ev.data, receivedAt: Date.now() });
  });
  useEffect(() => {
    const t = window.setInterval(() => setRealNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  if (!info) return { info: null, now: null };
  const base = Date.parse(info.clock.simTime);
  const elapsed = info.clock.paused ? 0 : Math.max(0, realNow - info.receivedAt) * info.clock.speed;
  return { info: info.clock, now: new Date(base + elapsed) };
}
