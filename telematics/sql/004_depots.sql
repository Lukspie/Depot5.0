-- Devices belong to a depot (code from db-wms depots.code). Only the Budimír depot (BUD) is
-- simulated with IoT devices; the Bratislava hub has none (ADR-039).
ALTER TABLE devices ADD COLUMN depot_code text NOT NULL DEFAULT 'BUD';
