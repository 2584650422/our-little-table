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
