/**
 * Write buffer for a replay (ADR-056): with db-telemetry in Azure every insert is a network round
 * trip, and a replay of a day makes thousands of them (one step per simulated minute). The buffer
 * collects the append-only rows and writes them in a few large statements at each sync point.
 * Everything else (reads, deletes, state) goes straight to the real sink.
 */

import type { DeviceRow, GateRow, GpsRow, HeartbeatRow, MetricRow, ScanRow, SensorRow, SimStateRow, TelemetrySink } from "./telemetry.js";

export class BufferedSink implements TelemetrySink {
  private scans: ScanRow[] = [];
  private gps: GpsRow[] = [];
  private heartbeats: HeartbeatRow[] = [];
  private gate: GateRow[] = [];
  private sensors: SensorRow[] = [];
  /** metrics are an additive upsert: rows of the same device and minute are summed here, because
   * one INSERT ... ON CONFLICT DO UPDATE cannot touch the same row twice */
  private metrics = new Map<string, MetricRow>();

  constructor(private readonly inner: TelemetrySink) {}

  /** rows waiting for the next flush */
  get pending(): number {
    return this.scans.length + this.gps.length + this.heartbeats.length + this.gate.length + this.sensors.length + this.metrics.size;
  }

  async flush(): Promise<void> {
    const scans = this.scans;
    const gps = this.gps;
    const heartbeats = this.heartbeats;
    const gate = this.gate;
    const sensors = this.sensors;
    const metrics = [...this.metrics.values()];
    this.scans = [];
    this.gps = [];
    this.heartbeats = [];
    this.gate = [];
    this.sensors = [];
    this.metrics = new Map();
    // one table after another: a failure keeps its rows and the not yet written ones for the
    // next flush (the written tables are not repeated, the metric upsert is additive)
    const steps: [() => Promise<void>, () => void][] = [
      [() => this.inner.insertScans(scans), () => this.scans.unshift(...scans)],
      [() => this.inner.insertGps(gps), () => this.gps.unshift(...gps)],
      [() => this.inner.insertHeartbeats(heartbeats), () => this.heartbeats.unshift(...heartbeats)],
      [() => this.inner.insertGatePassages(gate), () => this.gate.unshift(...gate)],
      [() => this.inner.insertSensorReadings(sensors), () => this.sensors.unshift(...sensors)],
      [() => this.inner.upsertMetrics(metrics), () => void this.upsertMetrics(metrics)],
    ];
    for (let i = 0; i < steps.length; i++) {
      try {
        await (steps[i] as [() => Promise<void>, () => void])[0]();
      } catch (err) {
        for (const [, restore] of steps.slice(i)) restore();
        throw err;
      }
    }
  }

  insertScans(rows: ScanRow[]): Promise<void> {
    this.scans.push(...rows);
    return Promise.resolve();
  }

  insertGps(rows: GpsRow[]): Promise<void> {
    this.gps.push(...rows);
    return Promise.resolve();
  }

  insertHeartbeats(rows: HeartbeatRow[]): Promise<void> {
    this.heartbeats.push(...rows);
    return Promise.resolve();
  }

  insertGatePassages(rows: GateRow[]): Promise<void> {
    this.gate.push(...rows);
    return Promise.resolve();
  }

  insertSensorReadings(rows: SensorRow[]): Promise<void> {
    this.sensors.push(...rows);
    return Promise.resolve();
  }

  upsertMetrics(rows: MetricRow[]): Promise<void> {
    for (const r of rows) {
      const key = `${String(r.deviceId)}|${String(r.minute)}`;
      const m = this.metrics.get(key);
      if (m) {
        m.items += r.items;
        m.readsOk += r.readsOk;
      } else {
        this.metrics.set(key, { ...r });
      }
    }
    return Promise.resolve();
  }

  // ---- straight through

  devices(): Promise<DeviceRow[]> {
    return this.inner.devices();
  }
  setDeviceEnabled(code: string, enabled: boolean): Promise<void> {
    return this.inner.setDeviceEnabled(code, enabled);
  }
  deviceMetrics(deviceId: number, from: number, to: number): Promise<MetricRow[]> {
    return this.inner.deviceMetrics(deviceId, from, to);
  }
  deleteSince(at: number): Promise<void> {
    return this.inner.deleteSince(at);
  }
  purgeGatePassages(before: number): Promise<string[]> {
    return this.inner.purgeGatePassages(before);
  }
  loadSimState(): Promise<SimStateRow | null> {
    return this.inner.loadSimState();
  }
  saveSimState(state: SimStateRow): Promise<void> {
    return this.inner.saveSimState(state);
  }
}
