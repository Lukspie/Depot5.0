-- db-telemetry: initial schema.
-- High-volume, append-only data from devices and vehicles. Business data lives in db-wms.

CREATE TABLE devices (
    id           serial PRIMARY KEY,
    code         text NOT NULL UNIQUE,
    kind         text NOT NULL
                 CHECK (kind IN ('dock_scanner', 'line_scanner', 'gate_camera', 'line_sensor')),
    -- door code from db-wms (doors.code); no FK across databases
    door_code    text,
    installed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE device_heartbeats (
    device_id integer NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    at        timestamptz NOT NULL,
    status    text NOT NULL CHECK (status IN ('online', 'degraded', 'offline')),
    PRIMARY KEY (device_id, at)
);

CREATE TABLE device_scan_events (
    id           bigserial PRIMARY KEY,
    device_id    integer NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    at           timestamptz NOT NULL,
    -- NULL when the label could not be read (the item is still counted)
    barcode      text,
    read_ok      boolean NOT NULL,
    faces_read   smallint NOT NULL DEFAULT 0 CHECK (faces_read BETWEEN 0 AND 6),
    item_counted boolean NOT NULL DEFAULT true
);
CREATE INDEX ix_device_scan_events_device_at ON device_scan_events (device_id, at);
CREATE INDEX ix_device_scan_events_barcode ON device_scan_events (barcode) WHERE barcode IS NOT NULL;

-- per-minute aggregate, input for the predictive-maintenance model
CREATE TABLE device_metrics_minutely (
    device_id integer NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    minute    timestamptz NOT NULL,
    items     integer NOT NULL,
    reads_ok  integer NOT NULL,
    read_rate real,
    PRIMARY KEY (device_id, minute)
);

CREATE TABLE gps_positions (
    vehicle_plate text NOT NULL,
    at            timestamptz NOT NULL,
    lat           double precision NOT NULL,
    lon           double precision NOT NULL,
    speed_kmh     real,
    heading       real,
    PRIMARY KEY (vehicle_plate, at)
);

-- personal data (licence plates, snapshots): purged after GATE_RETENTION_DAYS (GDPR)
CREATE TABLE gate_passages (
    id               bigserial PRIMARY KEY,
    at               timestamptz NOT NULL,
    direction        text NOT NULL CHECK (direction IN ('in', 'out')),
    vehicle_type     text NOT NULL,
    plate            text,
    plate_confidence real CHECK (plate_confidence BETWEEN 0 AND 1),
    snapshot_path    text,
    expected         boolean
);
CREATE INDEX ix_gate_passages_at ON gate_passages (at);

CREATE TABLE line_sensor_readings (
    at     timestamptz NOT NULL,
    sensor text NOT NULL,
    value  double precision NOT NULL,
    PRIMARY KEY (sensor, at)
);
