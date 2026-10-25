-- Devices of the Košice depot. Door codes match db-wms doors.code.
-- A scanner at every loading dock, one on the sorting line, a camera at the yard gate,
-- three line sensors.

INSERT INTO devices (code, kind, door_code) VALUES
    ('DOCK-SCN-01', 'dock_scanner', 'LD-01'),
    ('DOCK-SCN-02', 'dock_scanner', 'LD-02'),
    ('DOCK-SCN-03', 'dock_scanner', 'LD-03'),
    ('DOCK-SCN-04', 'dock_scanner', 'LD-04'),
    ('DOCK-SCN-05', 'dock_scanner', 'LD-05'),
    ('DOCK-SCN-06', 'dock_scanner', 'LD-06'),
    ('DOCK-SCN-07', 'dock_scanner', 'LD-07'),
    ('DOCK-SCN-08', 'dock_scanner', 'LD-08'),
    ('LINE-SCN-01', 'line_scanner', NULL),
    ('GATE-CAM-01', 'gate_camera',  'GATE-01'),
    ('LINE-SNS-01', 'line_sensor',  NULL),
    ('LINE-SNS-02', 'line_sensor',  NULL),
    ('LINE-SNS-03', 'line_sensor',  NULL)
ON CONFLICT (code) DO NOTHING;
