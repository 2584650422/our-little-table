const db = require('../config/db')

async function ensureCoupleMenu(coupleId) {
  const connection = await db.getConnection()
  const lockName = `little_table_menu_${coupleId}`
  try {
    const [[lock]] = await connection.query('SELECT GET_LOCK(?,5) acquired', [lockName])
    if (!lock.acquired) throw new Error('初始化饭桌菜单超时，请重试')
    await connection.beginTransaction()
    const [[{ categoryCount }]] = await connection.query(
      'SELECT COUNT(*) categoryCount FROM categories WHERE couple_id=?',
      [coupleId]
    )
    if (categoryCount) {
      await connection.commit()
      return
    }

    await connection.query(`INSERT INTO categories (couple_id,name,icon,sort_order,enabled)
      SELECT ?,name,icon,sort_order,enabled FROM starter_categories WHERE enabled=1`, [coupleId])
    await connection.query(`INSERT INTO dishes
      (couple_id,category_id,name,description,image_key,image_url,calorie_kcal,calorie_unit,calorie_note,serving_note,cook_time_minutes,difficulty,spicy_level,tags,enabled,sort_order,created_by)
      SELECT ?,own_category.id,d.name,d.description,d.image_key,d.image_url,d.calorie_kcal,d.calorie_unit,d.calorie_note,d.serving_note,d.cook_time_minutes,d.difficulty,d.spicy_level,d.tags,d.enabled,d.sort_order,NULL
      FROM starter_dishes d
      JOIN starter_categories starter_category ON starter_category.id=d.category_id
      JOIN categories own_category ON own_category.couple_id=? AND own_category.name=starter_category.name
      WHERE d.enabled=1`, [coupleId, coupleId])
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    await connection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {})
    connection.release()
  }
}

module.exports = { ensureCoupleMenu }
