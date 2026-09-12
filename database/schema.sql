CREATE DATABASE IF NOT EXISTS little_table CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE little_table;

CREATE TABLE couples (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL DEFAULT '我们的小饭桌',
  invite_code VARCHAR(8) UNIQUE,
  invite_expire_at DATETIME NULL,
  created_by BIGINT UNSIGNED NULL,
  anniversary DATE NULL,
  home_title VARCHAR(80) NOT NULL DEFAULT '今天想吃点什么呀？',
  home_subtitle VARCHAR(120) NOT NULL DEFAULT '认真选一顿，也是在认真过日子。',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  openid VARCHAR(64) NOT NULL UNIQUE,
  nickname VARCHAR(30) NOT NULL DEFAULT '新朋友',
  avatar_url VARCHAR(500) NULL,
  couple_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_couple FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE SET NULL,
  INDEX idx_users_couple (couple_id)
) ENGINE=InnoDB;

ALTER TABLE couples ADD CONSTRAINT fk_couples_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE starter_categories (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(30) NOT NULL UNIQUE,
  icon VARCHAR(16) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE starter_dishes (
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

CREATE TABLE categories (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  couple_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(30) NOT NULL,
  icon VARCHAR(16) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_categories_couple FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE CASCADE,
  CONSTRAINT fk_categories_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_category_scope_name (couple_id,name),
  INDEX idx_categories_scope (couple_id,enabled,sort_order)
) ENGINE=InnoDB;

CREATE TABLE dishes (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  couple_id BIGINT UNSIGNED NOT NULL,
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
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_dishes_couple FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE CASCADE,
  CONSTRAINT fk_dishes_category FOREIGN KEY (category_id) REFERENCES categories(id),
  CONSTRAINT fk_dishes_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_dishes_scope (couple_id, enabled, category_id, sort_order),
  INDEX idx_dishes_name (name)
) ENGINE=InnoDB;

CREATE TABLE favorites (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  dish_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_favorites_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_favorites_dish FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE CASCADE,
  UNIQUE KEY uk_favorite (user_id, dish_id)
) ENGINE=InnoDB;

CREATE TABLE orders (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_no VARCHAR(32) NOT NULL UNIQUE,
  couple_id BIGINT UNSIGNED NOT NULL,
  creator_user_id BIGINT UNSIGNED NOT NULL,
  target_user_id BIGINT UNSIGNED NULL,
  meal_type ENUM('breakfast','lunch','dinner','late_night','snack','casual') NOT NULL,
  meal_date DATE NOT NULL,
  message VARCHAR(300) NULL,
  status ENUM('pending','accepted','preparing','ready','completed','cancelled') NOT NULL DEFAULT 'pending',
  total_calories INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at DATETIME NULL,
  preparing_at DATETIME NULL,
  ready_at DATETIME NULL,
  completed_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  CONSTRAINT fk_orders_couple FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE CASCADE,
  CONSTRAINT fk_orders_creator FOREIGN KEY (creator_user_id) REFERENCES users(id),
  CONSTRAINT fk_orders_target FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_orders_couple_status_date (couple_id, status, meal_date, created_at)
) ENGINE=InnoDB;

CREATE TABLE order_items (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  dish_id BIGINT UNSIGNED NULL,
  dish_name VARCHAR(80) NOT NULL,
  dish_image_url VARCHAR(500) NULL,
  dish_calorie_kcal INT UNSIGNED NULL,
  dish_calorie_unit VARCHAR(16) NULL,
  quantity SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  note VARCHAR(120) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_dish FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE SET NULL,
  INDEX idx_order_items_order (order_id)
) ENGINE=InnoDB;

CREATE TABLE notifications (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(32) NOT NULL,
  title VARCHAR(80) NOT NULL,
  content VARCHAR(300) NULL,
  order_id BIGINT UNSIGNED NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  INDEX idx_notifications_unread (user_id, read_at, created_at)
) ENGINE=InnoDB;

CREATE TABLE meal_reviews (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  rating TINYINT UNSIGNED NULL,
  comment VARCHAR(300) NULL,
  image_key VARCHAR(255) NULL,
  image_url VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reviews_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uk_review_user_order (order_id, user_id)
) ENGINE=InnoDB;
