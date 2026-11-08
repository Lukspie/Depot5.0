/**
 * Writes and reads of db-telemetry. Bulk inserts use unnest() over arrays: one statement per batch
 * regardless of its size.
 */

import type pg from "pg";

export interface DeviceRow {
  id: number;
  code: string;
  kind: "dock_scanner" | "line_scanner" | "gate_camera" | "line_sensor" | "door_sensor";
  doorCode: string | null;
  enabled: boolean;
  depotCode: string;
}

export interface ScanRow {
  deviceId: number;
  at: number;
  barcode: string | null;
  readOk: boolean;
  facesRead: number;
  itemCounted: boolean;
}

export interface MetricRow {
  deviceId: number;
  minute: number;
  items: number;
  readsOk: number;
}

export interface HeartbeatRow {
  deviceId: number;
  at: number;
  status: "online" | "degraded" | "offline" | "maintenance";
}

export interface GpsRow {
  plate: string;
  at: number;
  lat: number;
  lon: number;
  speedKmh: number;
  heading: number;
}

export interface GateRow {
  at: number;
  direction: "in" | "out";
  vehicleType: string;
  plate: string | null;
  plateConfidence: number | null;
  snapshotPath: string | null;
  expected: boolean;
  /** confidence of the vehicle type model; goes to the app for the decision, not stored here */
  vehicleConfidence?: number | null;
  /** the depot whose gate it is (phase 7c); Budimír when absent; not stored here */
  depot?: string;
}

export interface SensorRow {
  at: number;
  sensor: string;
  value: number;
}

export interface SimStateRow {
  simTime: number;
  speed: number;
  paused: boolean;
  seed: number;
  envSeed: number;
  degradedDevice: string | null;
  degradationStartedAt: number | null;
  /** loaded situation and its cascade switch (sql/007); null = the .env settings */
  situation?: string | null;
  forceCascade?: boolean | null;
}

/** Everything the simulator persists; an in-memory fake implements it in tests. */
export interface TelemetrySink {
  devices(): Promise<DeviceRow[]>;
  setDeviceEnabled(code: string, enabled: boolean): Promise<void>;
  insertScans(rows: ScanRow[]): Promise<void>;
  upsertMetrics(rows: MetricRow[]): Promise<void>;
  /** per-minute counters of one device in [from, to) */
  deviceMetrics(deviceId: number, from: number, to: number): Promise<MetricRow[]>;
  insertHeartbeats(rows: HeartbeatRow[]): Promise<void>;
  insertGps(rows: GpsRow[]): Promise<void>;
  insertGatePassages(rows: GateRow[]): Promise<void>;
  insertSensorReadings(rows: SensorRow[]): Promise<void>;
  /** delete simulated telemetry at or after `at` (day restart) */
  deleteSince(at: number): Promise<void>;
  /** GDPR: delete gate passages older than `before`; returns snapshot paths to remove */
  purgeGatePassages(before: number): Promise<string[]>;
  loadSimState(): Promise<SimStateRow | null>;
  saveSimState(state: SimStateRow): Promise<void>;
}

const ts = (ms: number): string => new Date(ms).toISOString();

export class PgTelemetry implements TelemetrySink {
  constructor(private readonly pool: pg.Pool) {}

  async devices(): Promise<DeviceRow[]> {
    const { rows } = await this.pool.query<{
      id: number;
      code: string;
      kind: DeviceRow["kind"];
      door_code: string | null;
      enabled: boolean;
      depot_code: string;
    }>("SELECT id, code, kind, door_code, enabled, depot_code FROM devices ORDER BY code");
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      kind: r.kind,
      doorCode: r.door_code,
      enabled: r.enabled,
      depotCode: r.depot_code,
    }));
  }

  async setDeviceEnabled(code: string, enabled: boolean): Promise<void> {
    await this.pool.query("UPDATE devices SET enabled = $2 WHERE code = $1", [code, enabled]);
  }

  async insertScans(rows: ScanRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.pool.query(
      `INSERT INTO device_scan_events (device_id, at, barcode, read_ok, faces_read, item_counted)
       SELECT * FROM unnest($1::int[], $2::timestamptz[], $3::text[], $4::bool[], $5::smallint[], $6::bool[])`,
      [
        rows.map((r) => r.deviceId),
        rows.map((r) => ts(r.at)),
        rows.map((r) => r.barcode),
        rows.map((r) => r.readOk),
        rows.map((r) => r.facesRead),
        rows.map((r) => r.itemCounted),
      ],
    );
  }

  async upsertMetrics(rows: MetricRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.pool.query(
      `INSERT INTO device_metrics_minutely (device_id, minute, items, reads_ok, read_rate)
       SELECT d, m, i, r, CASE WHEN i > 0 THEN r::real / i END
       FROM unnest($1::int[], $2::timestamptz[], $3::int[], $4::int[]) AS t(d, m, i, r)
       ON CONFLICT (device_id, minute) DO UPDATE SET
         items = device_metrics_minutely.items + EXCLUDED.items,
         reads_ok = device_metrics_minutely.reads_ok + EXCLUDED.reads_ok,
         read_rate = (device_metrics_minutely.reads_ok + EXCLUDED.reads_ok)::real
                     / NULLIF(device_metrics_minutely.items + EXCLUDED.items, 0)`,
      [rows.map((r) => r.deviceId), rows.map((r) => ts(r.minute)), rows.map((r) => r.items), rows.map((r) => r.readsOk)],
    );
  }

  async deviceMetrics(deviceId: number, from: number, to: number): Promise<MetricRow[]> {
    const { rows } = await this.pool.query<{ minute: Date; items: number; reads_ok: number }>(
      `SELECT minute, items, reads_ok FROM device_metrics_minutely
       WHERE device_id = $1 AND minute >= $2 AND minute < $3 ORDER BY minute`,
      [deviceId, ts(from), ts(to)],
    );
    return rows.map((r) => ({ deviceId, minute: r.minute.getTime(), items: r.items, readsOk: r.reads_ok }));
  }

  async insertHeartbeats(rows: HeartbeatRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.pool.query(
      `INSERT INTO device_heartbeats (device_id, at, status)
       SELECT * FROM unnest($1::int[], $2::timestamptz[], $3::text[]) ON CONFLICT DO NOTHING`,
      [rows.map((r) => r.deviceId), rows.map((r) => ts(r.at)), rows.map((r) => r.status)],
    );
  }

  async insertGps(rows: GpsRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.pool.query(
      `INSERT INTO gps_positions (vehicle_plate, at, lat, lon, speed_kmh, heading)
       SELECT * FROM unnest($1::text[], $2::timestamptz[], $3::float8[], $4::float8[], $5::real[], $6::real[])
       ON CONFLICT DO NOTHING`,
      [
        rows.map((r) => r.plate),
        rows.map((r) => ts(r.at)),
        rows.map((r) => r.lat),
        rows.map((r) => r.lon),
        rows.map((r) => r.speedKmh),
        rows.map((r) => r.heading),
      ],
    );
  }

  async insertGatePassages(rows: GateRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.pool.query(
      `INSERT INTO gate_passages (at, direction, vehicle_type, plate, plate_confidence, snapshot_path, expected)
       SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::real[], $6::text[], $7::bool[])`,
      [
        rows.map((r) => ts(r.at)),
        rows.map((r) => r.direction),
        rows.map((r) => r.vehicleType),
        rows.map((r) => r.plate),
        rows.map((r) => r.plateConfidence),
        rows.map((r) => r.snapshotPath),
        rows.map((r) => r.expected),
      ],
    );
  }

  async insertSensorReadings(rows: SensorRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.pool.query(
      `INSERT INTO line_sensor_readings (at, sensor, value)
       SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::float8[]) ON CONFLICT DO NOTHING`,
      [rows.map((r) => ts(r.at)), rows.map((r) => r.sensor), rows.map((r) => r.value)],
    );
  }

  async deleteSince(at: number): Promise<void> {
    const t = ts(at);
    for (const [table, col] of [
      ["device_scan_events", "at"],
      ["device_metrics_minutely", "minute"],
      ["device_heartbeats", "at"],
      ["gps_positions", "at"],
      ["gate_passages", "at"],
      ["line_sensor_readings", "at"],
    ] as const) {
      await this.pool.query(`DELETE FROM ${table} WHERE ${col} >= $1`, [t]);
    }
  }

  async purgeGatePassages(before: number): Promise<string[]> {
    const { rows } = await this.pool.query<{ snapshot_path: string | null }>(
      "DELETE FROM gate_passages WHERE at < $1 RETURNING snapshot_path",
      [ts(before)],
    );
    return rows.map((r) => r.snapshot_path).filter((p): p is string => p !== null);
  }

  async loadSimState(): Promise<SimStateRow | null> {
    const { rows } = await this.pool.query<{
      sim_time: Date;
      speed: number;
      paused: boolean;
      seed: number;
      env_seed: number;
      degraded_device: string | null;
      degradation_started_at: Date | null;
      situation: string | null;
      force_cascade: boolean | null;
    }>("SELECT * FROM sim_state WHERE id = 1");
    const r = rows[0];
    if (!r) return null;
    return {
      simTime: r.sim_time.getTime(),
      speed: r.speed,
      paused: r.paused,
      seed: r.seed,
      envSeed: r.env_seed,
      degradedDevice: r.degraded_device,
      degradationStartedAt: r.degradation_started_at ? r.degradation_started_at.getTime() : null,
      situation: r.situation,
      forceCascade: r.force_cascade,
    };
  }

  async saveSimState(s: SimStateRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO sim_state (id, sim_time, speed, paused, seed, env_seed, degraded_device, degradation_started_at, situation, force_cascade, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       ON CONFLICT (id) DO UPDATE SET sim_time = $1, speed = $2, paused = $3, seed = $4, env_seed = $5,
         degraded_device = $6, degradation_started_at = $7, situation = $8, force_cascade = $9, updated_at = now()`,
      [
        ts(s.simTime),
        s.speed,
        s.paused,
        s.seed,
        s.envSeed,
        s.degradedDevice,
        s.degradationStartedAt === null ? null : ts(s.degradationStartedAt),
        s.situation ?? null,
        s.forceCascade ?? null,
      ],
    );
  }
}
