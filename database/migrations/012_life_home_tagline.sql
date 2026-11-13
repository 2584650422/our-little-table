-- 首页一句话独立于小饭桌的菜谱推荐文案；两位成员共享。
ALTER TABLE couples
  ADD COLUMN life_tagline VARCHAR(60) NOT NULL DEFAULT '把日子慢慢过。' AFTER home_subtitle;
