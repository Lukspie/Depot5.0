-- Phase 5: a device marked for maintenance in the WMS reports status 'maintenance' (ADR-048).
ALTER TABLE device_heartbeats DROP CONSTRAINT IF EXISTS device_heartbeats_status_check;
ALTER TABLE device_heartbeats
    ADD CONSTRAINT device_heartbeats_status_check
    CHECK (status IN ('online', 'degraded', 'offline', 'maintenance'));
