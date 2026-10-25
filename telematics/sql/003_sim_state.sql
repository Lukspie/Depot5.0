-- Simulator state survives restarts of the telematics container (clock, seed, degradation).

CREATE TABLE sim_state (
    id                     smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    sim_time               timestamptz NOT NULL,
    speed                  real NOT NULL,
    paused                 boolean NOT NULL,
    seed                   integer NOT NULL,
    -- SIM_RANDOM_SEED from .env at the last start; a change in .env re-applies it
    env_seed               integer NOT NULL,
    degraded_device        text,
    degradation_started_at timestamptz,
    updated_at             timestamptz NOT NULL DEFAULT now()
);

-- admin can switch a device off for the demo (it stops sending heartbeats -> offline)
ALTER TABLE devices ADD COLUMN enabled boolean NOT NULL DEFAULT true;

-- restarting a simulated day deletes its telemetry by time
CREATE INDEX ix_gps_positions_at ON gps_positions (at);
CREATE INDEX ix_device_heartbeats_at ON device_heartbeats (at);
CREATE INDEX ix_line_sensor_readings_at ON line_sensor_readings (at);
CREATE INDEX ix_device_metrics_minutely_minute ON device_metrics_minutely (minute);
