USE little_table;

-- Track only permissions explicitly accepted in the mini-program client.
-- WeChat does not expose an authoritative remaining-count query for one-time templates.
CREATE TABLE wechat_subscription_grants (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  request_id VARCHAR(80) NOT NULL,
  template_id VARCHAR(128) NOT NULL,
  event VARCHAR(16) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_wechat_grants_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uk_wechat_grant_request (user_id, request_id, template_id)
) ENGINE=InnoDB;

CREATE TABLE wechat_subscription_credits (
  user_id BIGINT UNSIGNED NOT NULL,
  template_id VARCHAR(128) NOT NULL,
  event VARCHAR(16) NOT NULL,
  available_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, template_id),
  CONSTRAINT fk_wechat_credits_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
