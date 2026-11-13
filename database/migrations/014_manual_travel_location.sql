-- 手动填写地点名称时没有坐标；地图选点仍保存坐标并显示地图标记。
ALTER TABLE travel_photos
 MODIFY latitude DECIMAL(10,7) NULL,
 MODIFY longitude DECIMAL(10,7) NULL;
