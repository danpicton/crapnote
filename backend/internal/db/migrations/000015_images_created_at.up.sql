-- Lets the orphan-image sweep find aged candidates by index rather than
-- scanning the whole images table on every hourly pass.
CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at);
