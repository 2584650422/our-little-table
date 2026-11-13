-- 两个人的生活空间；不初始化示例数据，沿用 couples 的双人隔离。
CREATE TABLE IF NOT EXISTS life_events (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
 couple_id BIGINT UNSIGNED NOT NULL,
 title VARCHAR(60) NOT NULL,
 event_date DATE NOT NULL,
 kind VARCHAR(16) NOT NULL DEFAULT 'countdown',
 calendar_type VARCHAR(8) NOT NULL DEFAULT 'solar',
 annual BOOLEAN NOT NULL DEFAULT FALSE,
 remind_days TINYINT UNSIGNED NOT NULL DEFAULT 7,
 created_by BIGINT UNSIGNED NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_life_events_couple FOREIGN KEY(couple_id) REFERENCES couples(id) ON DELETE CASCADE,
 CONSTRAINT fk_life_events_user FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL,
 INDEX idx_life_events_couple(couple_id,event_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS travel_photos (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
 couple_id BIGINT UNSIGNED NOT NULL,
 original_key VARCHAR(255) NOT NULL,
 preview_key VARCHAR(255) NOT NULL,
 width INT UNSIGNED NOT NULL,
 height INT UNSIGNED NOT NULL,
 original_bytes BIGINT UNSIGNED NOT NULL,
 preview_bytes INT UNSIGNED NOT NULL,
 city VARCHAR(80) NOT NULL,
 latitude DECIMAL(10,7) NOT NULL,
 longitude DECIMAL(10,7) NOT NULL,
 taken_on DATE NOT NULL,
 caption VARCHAR(200) NOT NULL DEFAULT '',
 created_by BIGINT UNSIGNED NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_travel_photos_couple FOREIGN KEY(couple_id) REFERENCES couples(id) ON DELETE CASCADE,
 CONSTRAINT fk_travel_photos_user FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL,
 UNIQUE KEY uq_travel_original(original_key),
 INDEX idx_travel_photos_couple(couple_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
