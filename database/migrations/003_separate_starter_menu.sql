USE little_table;

CREATE TABLE IF NOT EXISTS starter_categories (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(30) NOT NULL UNIQUE,
  icon VARCHAR(16) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS starter_dishes (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  category_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(255) NULL,
  image_key VARCHAR(255) NULL,
  image_url VARCHAR(500) NULL,
  calorie_kcal INT UNSIGNED NULL,
  calorie_unit VARCHAR(16) NOT NULL DEFAULT '份',
  calorie_note VARCHAR(80) NOT NULL DEFAULT '家庭做法估算值',
  serving_note VARCHAR(80) NULL,
  cook_time_minutes INT UNSIGNED NULL,
  difficulty ENUM('easy','medium','hard') NULL,
  spicy_level TINYINT UNSIGNED NULL,
  tags JSON NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_starter_dishes_category FOREIGN KEY (category_id) REFERENCES starter_categories(id),
  INDEX idx_starter_dishes_category (category_id,enabled,sort_order)
) ENGINE=InnoDB;

INSERT IGNORE INTO starter_categories (name,icon,sort_order,enabled)
SELECT name,icon,sort_order,enabled FROM categories WHERE couple_id IS NULL;

INSERT INTO starter_dishes (category_id,name,description,image_key,image_url,calorie_kcal,calorie_unit,calorie_note,serving_note,cook_time_minutes,difficulty,spicy_level,tags,enabled,sort_order)
SELECT sc.id,d.name,d.description,d.image_key,d.image_url,d.calorie_kcal,d.calorie_unit,d.calorie_note,d.serving_note,d.cook_time_minutes,d.difficulty,d.spicy_level,d.tags,d.enabled,d.sort_order
FROM dishes d
JOIN categories c ON c.id=d.category_id
JOIN starter_categories sc ON sc.name=c.name
WHERE d.couple_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM starter_dishes sd WHERE sd.name=d.name AND sd.category_id=sc.id);

DELETE FROM dishes WHERE couple_id IS NULL;
DELETE FROM categories WHERE couple_id IS NULL;

ALTER TABLE categories MODIFY couple_id BIGINT UNSIGNED NOT NULL;
ALTER TABLE dishes MODIFY couple_id BIGINT UNSIGNED NOT NULL;
