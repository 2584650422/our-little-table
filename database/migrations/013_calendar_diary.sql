-- 当天记录与纪念日共享空间隔离和日期索引；旧记录正文为空。
ALTER TABLE life_events ADD COLUMN content TEXT NULL AFTER title;
