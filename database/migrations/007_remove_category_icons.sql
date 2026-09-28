USE little_table;

-- Apply only AFTER the Python API version that no longer queries category.icon
-- has been deployed and verified. Back up the database first: DROP COLUMN
-- permanently removes any custom icon values.
ALTER TABLE categories
  DROP COLUMN icon;

ALTER TABLE starter_categories
  DROP COLUMN icon;

-- The old rating was never exposed or written; current records have NULL.
ALTER TABLE meal_reviews
  DROP COLUMN rating;
