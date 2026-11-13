CREATE DATABASE IF NOT EXISTS our_time CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE our_time;

CREATE TABLE spaces (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL UNIQUE,
  name VARCHAR(50) NOT NULL DEFAULT '我们的时光',
  invite_code VARCHAR(8) UNIQUE,
  invite_expire_at DATETIME NULL,
  created_by BIGINT UNSIGNED NULL,
  anniversary DATE NULL,
  home_title VARCHAR(80) NOT NULL DEFAULT '今天想吃什么？',
  home_subtitle VARCHAR(120) NOT NULL DEFAULT '和你一起吃饭，就是好日子',
  life_tagline VARCHAR(60) NOT NULL DEFAULT '把日子慢慢过。',
  background_image_key VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  openid VARCHAR(64) NOT NULL UNIQUE,
  nickname VARCHAR(30) NOT NULL DEFAULT '新朋友',
  avatar_key VARCHAR(255) NULL,
  avatar_url VARCHAR(500) NULL,
  space_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_couple FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE SET NULL,
  INDEX idx_users_couple (space_id)
) ENGINE=InnoDB;

ALTER TABLE spaces ADD CONSTRAINT fk_couples_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE space_members (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  space_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at DATETIME NULL,
  CONSTRAINT fk_couple_members_couple FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_couple_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uk_couple_member (space_id,user_id),
  INDEX idx_member_user_active (user_id,left_at,joined_at),
  INDEX idx_member_couple_active (space_id,left_at)
) ENGINE=InnoDB;

CREATE TABLE category_templates (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(30) NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE dish_templates (
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
  CONSTRAINT fk_starter_dishes_category FOREIGN KEY (category_id) REFERENCES category_templates(id),
  INDEX idx_starter_dishes_category (category_id,enabled,sort_order)
) ENGINE=InnoDB;

CREATE TABLE dish_categories (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  space_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(30) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_categories_couple FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_categories_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_category_scope_name (space_id,name),
  INDEX idx_categories_scope (space_id,enabled,sort_order)
) ENGINE=InnoDB;

CREATE TABLE dishes (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  space_id BIGINT UNSIGNED NOT NULL,
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
  deleted_at DATETIME NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_dishes_couple FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_dishes_category FOREIGN KEY (category_id) REFERENCES dish_categories(id),
  CONSTRAINT fk_dishes_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_dishes_scope (space_id, enabled, category_id, sort_order),
  INDEX idx_dishes_name (name)
) ENGINE=InnoDB;

CREATE TABLE dish_favorites (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  dish_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_favorites_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_favorites_dish FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE CASCADE,
  UNIQUE KEY uk_favorite (user_id, dish_id)
) ENGINE=InnoDB;

CREATE TABLE meals (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_no VARCHAR(32) NOT NULL UNIQUE,
  space_id BIGINT UNSIGNED NOT NULL,
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
  CONSTRAINT fk_orders_couple FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_orders_creator FOREIGN KEY (creator_user_id) REFERENCES users(id),
  CONSTRAINT fk_orders_target FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_orders_couple_status_date (space_id, status, meal_date, created_at)
) ENGINE=InnoDB;

CREATE TABLE meal_items (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  meal_id BIGINT UNSIGNED NOT NULL,
  dish_id BIGINT UNSIGNED NULL,
  dish_name VARCHAR(80) NOT NULL,
  dish_image_key VARCHAR(255) NULL,
  dish_image_url VARCHAR(500) NULL,
  dish_calorie_kcal INT UNSIGNED NULL,
  dish_calorie_unit VARCHAR(16) NULL,
  quantity SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  note VARCHAR(120) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_items_order FOREIGN KEY (meal_id) REFERENCES meals(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_dish FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE SET NULL,
  INDEX idx_order_items_order (meal_id)
) ENGINE=InnoDB;

CREATE TABLE messages (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(32) NOT NULL,
  title VARCHAR(80) NOT NULL,
  content VARCHAR(300) NULL,
  meal_id BIGINT UNSIGNED NULL,
  event_key CHAR(36) NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_order FOREIGN KEY (meal_id) REFERENCES meals(id) ON DELETE CASCADE,
  INDEX idx_notifications_event (event_key, user_id),
  INDEX idx_notifications_unread (user_id, read_at, created_at)
) ENGINE=InnoDB;

CREATE TABLE subscription_grants (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  request_id VARCHAR(80) NOT NULL,
  template_id VARCHAR(128) NOT NULL,
  event VARCHAR(16) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_wechat_grants_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uk_wechat_grant_request (user_id, request_id, template_id)
) ENGINE=InnoDB;

CREATE TABLE subscription_credits (
  user_id BIGINT UNSIGNED NOT NULL,
  template_id VARCHAR(128) NOT NULL,
  event VARCHAR(16) NOT NULL,
  available_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, template_id),
  CONSTRAINT fk_wechat_credits_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE meal_reviews (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  meal_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  comment VARCHAR(300) NULL,
  image_key VARCHAR(255) NULL,
  image_url VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reviews_order FOREIGN KEY (meal_id) REFERENCES meals(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uk_review_user_order (meal_id, user_id)
) ENGINE=InnoDB;

-- 两个人的生活空间；不初始化示例数据，沿用 spaces 的双人隔离。
CREATE TABLE IF NOT EXISTS calendar_entries (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
 space_id BIGINT UNSIGNED NOT NULL,
 title VARCHAR(60) NOT NULL,
 content TEXT NULL,
 event_date DATE NOT NULL,
 kind VARCHAR(16) NOT NULL DEFAULT 'countdown',
 calendar_type VARCHAR(8) NOT NULL DEFAULT 'solar',
 annual BOOLEAN NOT NULL DEFAULT FALSE,
 remind_days TINYINT UNSIGNED NOT NULL DEFAULT 7,
 created_by BIGINT UNSIGNED NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_life_events_couple FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE,
 CONSTRAINT fk_life_events_user FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL,
 INDEX idx_life_events_couple(space_id,event_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS photos (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
 space_id BIGINT UNSIGNED NOT NULL,
 original_key VARCHAR(255) NOT NULL,
 preview_key VARCHAR(255) NOT NULL,
 width INT UNSIGNED NOT NULL,
 height INT UNSIGNED NOT NULL,
 original_bytes BIGINT UNSIGNED NOT NULL,
 preview_bytes INT UNSIGNED NOT NULL,
 city VARCHAR(80) NOT NULL,
 latitude DECIMAL(10,7) NULL,
 longitude DECIMAL(10,7) NULL,
 taken_on DATE NOT NULL,
 caption VARCHAR(200) NOT NULL DEFAULT '',
 created_by BIGINT UNSIGNED NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_travel_photos_couple FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE,
 CONSTRAINT fk_travel_photos_user FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL,
 UNIQUE KEY uq_travel_original(original_key),
 INDEX idx_travel_photos_couple(space_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Run on our_time after schema 015, before deploying the matching API.
-- Additive migration; no existing rows are changed. MySQL DDL auto-commits.
CREATE TABLE IF NOT EXISTS thought_messages (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  space_id BIGINT UNSIGNED NOT NULL,
  sender_id BIGINT UNSIGNED NOT NULL,
  recipient_id BIGINT UNSIGNED NOT NULL,
  root_id BIGINT UNSIGNED NULL,
  request_id VARCHAR(80) NOT NULL,
  content VARCHAR(100) NOT NULL,
  read_at DATETIME NULL,
  deleted_at DATETIME NULL,
  wx_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_thought_space FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_thought_sender FOREIGN KEY (sender_id) REFERENCES users(id),
  CONSTRAINT fk_thought_recipient FOREIGN KEY (recipient_id) REFERENCES users(id),
  CONSTRAINT fk_thought_root FOREIGN KEY (root_id) REFERENCES thought_messages(id),
  UNIQUE KEY uq_thought_request (space_id,sender_id,request_id),
  KEY idx_thought_roots (space_id,root_id,id),
  KEY idx_thought_inbox (space_id,recipient_id,read_at,id),
  KEY idx_thought_day (space_id,created_at),
  KEY idx_thought_cooldown (space_id,sender_id,recipient_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='想你了留言、回复与阅读记录';

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id BIGINT UNSIGNED NOT NULL,
  event VARCHAR(20) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id,event),
  CONSTRAINT fk_notification_preference_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='每位成员各类微信提醒的接收开关';

-- BEGIN TABLE GUIDE (generated)
CREATE TABLE IF NOT EXISTS table_guide (
  table_name VARCHAR(64) PRIMARY KEY,
  module VARCHAR(30) NOT NULL,
  purpose VARCHAR(160) NOT NULL,
  contents VARCHAR(600) NOT NULL,
  privacy_note VARCHAR(600) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数据库表用途与维护说明';

ALTER TABLE `spaces` COMMENT='两个人共享的生活空间';
ALTER TABLE `users` COMMENT='微信用户与当前空间';
ALTER TABLE `space_members` COMMENT='空间成员与加入退出历史';
ALTER TABLE `category_templates` COMMENT='新空间的分类模板';
ALTER TABLE `dish_templates` COMMENT='可选的菜谱模板';
ALTER TABLE `dish_categories` COMMENT='空间自己的菜品分类';
ALTER TABLE `dishes` COMMENT='空间里的菜谱';
ALTER TABLE `dish_favorites` COMMENT='个人收藏的菜谱';
ALTER TABLE `meals` COMMENT='每一顿点菜与用餐记录';
ALTER TABLE `meal_items` COMMENT='每一顿的菜品快照';
ALTER TABLE `meal_reviews` COMMENT='饭后感受与成品照片';
ALTER TABLE `messages` COMMENT='小程序内消息与双方已读状态';
ALTER TABLE `subscription_grants` COMMENT='微信一次性订阅授权去重记录';
ALTER TABLE `subscription_credits` COMMENT='每人每模板的预计剩余提醒机会';
ALTER TABLE `calendar_entries` COMMENT='当天记录、生日、纪念日和倒数日';
ALTER TABLE `photos` COMMENT='旅行照片与拍摄地点';
ALTER TABLE `thought_messages` COMMENT='想你了留言、回复与阅读记录';
ALTER TABLE `notification_preferences` COMMENT='每位成员各类微信提醒的接收开关';
ALTER TABLE `table_guide` COMMENT='数据库内的中文表说明';

INSERT INTO table_guide (table_name,module,purpose,contents,privacy_note) VALUES
('spaces','共同空间','两个人共享的生活空间','空间名称、邀请信息、起始日、首页文案和背景图片 key','邀请码有有效期；图片 key 不是访问密钥。'),
('users','共同空间','微信用户与当前空间','微信 OpenID、昵称、头像 key、当前 space_id','OpenID 是微信用户标识，不是加密内容或密码；仅后端使用。'),
('space_members','共同空间','空间成员与加入退出历史','space_id、user_id、加入时间与退出时间','用于双人上限、成员关系和访问隔离，不应随意清除。'),
('category_templates','饭桌','新空间的分类模板','预设分类名称、排序和启用状态','公共初始化模板，不存两人的私密记录。'),
('dish_templates','饭桌','可选的菜谱模板','模板菜名、描述、图片和估算热量','现有空间不自动导入示例菜，保留模板兼容历史初始化。'),
('dish_categories','饭桌','空间自己的菜品分类','分类名称、排序、启用状态、space_id','每个空间独立；不允许跨空间关联菜品。'),
('dishes','饭桌','空间里的菜谱','菜名、做法描述、图片 key、估算热量、上架和软删除状态','下架和删除不破坏历史用餐快照。'),
('dish_favorites','饭桌','个人收藏的菜谱','user_id、dish_id、收藏时间','每位用户独立收藏。'),
('meals','饭桌','每一顿点菜与用餐记录','点菜编号、用餐日期、餐次、发起人与做饭人、状态和时间','按 space_id 隔离；是私人用餐记录，不涉及交易和支付。'),
('meal_items','饭桌','每一顿的菜品快照','meal_id、当时的菜名、图片、热量与份数','历史快照需要保留；原菜谱变化不会改写过去的记录。'),
('meal_reviews','饭桌','饭后感受与成品照片','meal_id、记录人、文字、图片 key','每人每顿最多一条；图片可能被其他历史记录引用。'),
('messages','消息','小程序内消息与双方已读状态','收件人、消息类型、标题正文、meal_id、事件编号与已读时间','每人只更新本人的已读状态；事件编号用于关联同一次通知。'),
('subscription_grants','消息','微信一次性订阅授权去重记录','user_id、request_id、template_id、提醒事件、授权登记时间','request_id 是防重复计次编号；template_id 是微信模板标识，不是加密正文。保留去重记录防重放。'),
('subscription_credits','消息','每人每模板的预计剩余提醒机会','user_id、template_id、提醒事件、available_count（上限10）','本地估算账本，不等于微信官方实时余额。发送前扣减，失败按规则退回或归零。'),
('calendar_entries','日历','当天记录、生日、纪念日和倒数日','标题、可选正文、日期、记录类型、历法、提醒设置、创建人与 space_id','当天记录不加入倒计时；类型决定颜色，创建人用于头像归属。'),
('photos','足迹','旅行照片与拍摄地点','原图和预览图 key、尺寸字节数、地点坐标、拍摄日、随手记和创建人','图片本体在私有 COS；坐标为用户选择的位置，不是持续定位记录。'),
('thought_messages','想你了','想你了留言、回复与阅读记录','space_id、发送人与接收人、根留言、幂等请求号、正文、已读和删除时间、微信请求状态','令牌空间隔离；仅接收人可标记已读、仅发送人可软删除。删除根留言时整组隐藏；正文不写日志。'),
('notification_preferences','消息','每位成员各类微信提醒的接收开关','user_id、created/served/thought事件、启用状态和更新时间','只修改本人接收偏好，不改变对方开关，不等同微信系统授权状态。'),
('table_guide','维护','数据库内的中文表说明','每张表的模块、用途、保存内容和隐私及维护说明','仅文档元数据，不复制用户记录、不保存任何配置密钥。')
ON DUPLICATE KEY UPDATE module=VALUES(module),purpose=VALUES(purpose),contents=VALUES(contents),privacy_note=VALUES(privacy_note);
