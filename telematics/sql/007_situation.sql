-- Situations (phase 5d, ADR-054): a loaded situation overrides the scenario switches of .env until
-- the next clean reset; they must survive a restart of the telematics container like the seed.

ALTER TABLE sim_state
    ADD COLUMN situation text,
    ADD COLUMN force_cascade boolean;
