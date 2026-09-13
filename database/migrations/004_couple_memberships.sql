USE little_table;

ALTER TABLE couples ADD COLUMN public_id CHAR(36) NULL AFTER id;
UPDATE couples SET public_id=UUID() WHERE public_id IS NULL OR public_id='';
ALTER TABLE couples MODIFY public_id CHAR(36) NOT NULL;
ALTER TABLE couples ADD UNIQUE KEY uk_couples_public_id (public_id);

CREATE TABLE IF NOT EXISTS couple_members (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  couple_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at DATETIME NULL,
  CONSTRAINT fk_couple_members_couple FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE CASCADE,
  CONSTRAINT fk_couple_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uk_couple_member (couple_id,user_id),
  INDEX idx_member_user_active (user_id,left_at,joined_at),
  INDEX idx_member_couple_active (couple_id,left_at)
) ENGINE=InnoDB;

INSERT INTO couple_members (couple_id,user_id,joined_at)
SELECT couple_id,id,created_at FROM users WHERE couple_id IS NOT NULL
ON DUPLICATE KEY UPDATE left_at=NULL;
