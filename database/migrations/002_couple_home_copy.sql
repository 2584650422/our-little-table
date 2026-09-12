USE little_table;

ALTER TABLE couples
  ADD COLUMN home_title VARCHAR(80) NOT NULL DEFAULT '今天想吃点什么呀？' AFTER anniversary,
  ADD COLUMN home_subtitle VARCHAR(120) NOT NULL DEFAULT '认真选一顿，也是在认真过日子。' AFTER home_title;
