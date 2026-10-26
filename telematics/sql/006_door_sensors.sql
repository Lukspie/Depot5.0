-- Phase 5c: a cheap door contact sensor (retrofit) at every loading door (ADR-050).
-- It reports open / closed / fault of the door; the digital shadow only shows it.
-- It never sends scans, so it is not part of read rates, device metrics or the ML data.
ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_kind_check;
ALTER TABLE devices
    ADD CONSTRAINT devices_kind_check
    CHECK (kind IN ('dock_scanner', 'line_scanner', 'gate_camera', 'line_sensor', 'door_sensor'));

INSERT INTO devices (code, kind, door_code) VALUES
    ('DOOR-SNS-01', 'door_sensor', 'LD-01'),
    ('DOOR-SNS-02', 'door_sensor', 'LD-02'),
    ('DOOR-SNS-03', 'door_sensor', 'LD-03'),
    ('DOOR-SNS-04', 'door_sensor', 'LD-04'),
    ('DOOR-SNS-05', 'door_sensor', 'LD-05'),
    ('DOOR-SNS-06', 'door_sensor', 'LD-06'),
    ('DOOR-SNS-07', 'door_sensor', 'LD-07'),
    ('DOOR-SNS-08', 'door_sensor', 'LD-08')
ON CONFLICT (code) DO NOTHING;
