USE little_table;

-- Existing URL columns are retained temporarily for old records. New uploads
-- persist only Object Keys; API responses hydrate them into signed read URLs.
ALTER TABLE users ADD COLUMN avatar_key VARCHAR(255) NULL AFTER nickname;
ALTER TABLE order_items ADD COLUMN dish_image_key VARCHAR(255) NULL AFTER dish_name;

