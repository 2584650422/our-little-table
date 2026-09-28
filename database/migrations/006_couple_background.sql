USE little_table;

-- Additive step: safe while the older API is still running.
ALTER TABLE couples
  ADD COLUMN background_image_key VARCHAR(255) NULL AFTER home_subtitle;
