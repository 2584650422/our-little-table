-- 先备份数据库。仅在已有数据库尚未执行本迁移时执行；新建数据库使用 schema.sql。
-- 两项均为增量字段，旧 API 仍可运行；升级 API 前先执行本迁移。
ALTER TABLE dishes ADD COLUMN deleted_at DATETIME NULL AFTER enabled;
ALTER TABLE notifications ADD COLUMN event_key CHAR(36) NULL AFTER order_id,
  ADD INDEX idx_notifications_event (event_key, user_id);
-- 历史消息没有可靠事件关联，保留 NULL；不推测或伪造另一成员的阅读状态。
