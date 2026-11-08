-- Phase 7d step 5d (ADR-071): checkpoints of the sorting lines are devices. The line graph is in
-- the depot layout of db-wms (layout.line); `variant` says whether the checkpoint exists today
-- (current) or only in the Depot 5.0 proposal for Budimír. Checkpoints report no heartbeat: the
-- simulator counts their passages from the line (scanners and dock scanners stay what they were).
ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_kind_check;
ALTER TABLE devices
    ADD CONSTRAINT devices_kind_check
    CHECK (kind IN ('dock_scanner', 'line_scanner', 'gate_camera', 'line_sensor', 'door_sensor', 'checkpoint'));
ALTER TABLE devices ADD COLUMN variant text NOT NULL DEFAULT 'current'
    CHECK (variant IN ('current', 'proposal'));

INSERT INTO devices (code, kind, door_code, depot_code, variant) VALUES
    -- Budimír today: the light barrier at the end of the collector (the scanner on the bridge is
    -- LINE-SCN-01, the ends of the linehaul belts are the dock scanners)
    ('CP-BUD-ZB',   'checkpoint', NULL,    'BUD', 'current'),
    -- Budimír, proposal: a counter at every input and output, the scan tunnel, decoding
    ('CP-BUD-K1',   'checkpoint', 'SB-01', 'BUD', 'proposal'),
    ('CP-BUD-K2',   'checkpoint', 'SB-02', 'BUD', 'proposal'),
    ('CP-BUD-K3',   'checkpoint', 'SB-03', 'BUD', 'proposal'),
    ('CP-BUD-K4',   'checkpoint', 'SB-04', 'BUD', 'proposal'),
    ('CP-BUD-T1',   'checkpoint', 'LD-01', 'BUD', 'proposal'),
    ('CP-BUD-T2',   'checkpoint', 'LD-02', 'BUD', 'proposal'),
    ('CP-BUD-T3',   'checkpoint', 'LD-03', 'BUD', 'proposal'),
    ('CP-BUD-G1',   'checkpoint', 'LD-04', 'BUD', 'proposal'),
    ('CP-BUD-G2',   'checkpoint', 'LD-05', 'BUD', 'proposal'),
    ('CP-BUD-M',    'checkpoint', NULL,    'BUD', 'proposal'),
    ('CP-BUD-TUN',  'checkpoint', NULL,    'BUD', 'proposal'),
    ('CP-BUD-DEK',  'checkpoint', NULL,    'BUD', 'proposal'),
    ('CP-BUD-LD04', 'checkpoint', 'LD-04', 'BUD', 'proposal'),
    ('CP-BUD-LD05', 'checkpoint', 'LD-05', 'BUD', 'proposal'),
    ('CP-BUD-LD06', 'checkpoint', 'LD-06', 'BUD', 'proposal'),
    ('CP-BUD-LD07', 'checkpoint', 'LD-07', 'BUD', 'proposal'),
    ('CP-BUD-LD08', 'checkpoint', 'LD-08', 'BUD', 'proposal'),
    ('CP-BUD-SB01', 'checkpoint', 'SB-01', 'BUD', 'proposal'),
    ('CP-BUD-SB02', 'checkpoint', 'SB-02', 'BUD', 'proposal'),
    ('CP-BUD-SB03', 'checkpoint', 'SB-03', 'BUD', 'proposal'),
    ('CP-BUD-SB04', 'checkpoint', 'SB-04', 'BUD', 'proposal'),
    ('CP-BUD-SB05', 'checkpoint', 'SB-05', 'BUD', 'proposal'),
    ('CP-BUD-SB06', 'checkpoint', 'SB-06', 'BUD', 'proposal'),
    ('CP-BUD-SB07', 'checkpoint', 'SB-07', 'BUD', 'proposal'),
    ('CP-BUD-SB08', 'checkpoint', 'SB-08', 'BUD', 'proposal'),
    -- the other depots: the line that fits their hall, today only
    ('CP-ZIL-IN',   'checkpoint', NULL,    'ZIL', 'current'),
    ('CP-ZIL-SCN',  'checkpoint', NULL,    'ZIL', 'current'),
    ('CP-BA-IN',    'checkpoint', NULL,    'BAH', 'current'),
    ('CP-BA-SCN',   'checkpoint', NULL,    'BAH', 'current'),
    ('CP-DS-IN',    'checkpoint', NULL,    'DS',  'current'),
    ('CP-TN-IN',    'checkpoint', NULL,    'TN',  'current')
ON CONFLICT (code) DO NOTHING;
