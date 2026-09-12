USE little_table;

ALTER TABLE categories
  ADD COLUMN couple_id BIGINT UNSIGNED NULL COMMENT 'NULL means starter category template' AFTER id,
  ADD COLUMN created_by BIGINT UNSIGNED NULL AFTER enabled,
  ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
  DROP INDEX uk_category_name,
  ADD CONSTRAINT fk_categories_couple FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_categories_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  ADD UNIQUE KEY uk_category_scope_name (couple_id,name),
  ADD INDEX idx_categories_scope (couple_id,enabled,sort_order);

-- Existing couples receive their own editable category and dish copies lazily
-- on the next API request. Starter rows with couple_id=NULL remain templates.
