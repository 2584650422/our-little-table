function scoreDish(dish) {
  const days = dish.lastEatenAt ? Math.floor((Date.now() - new Date(dish.lastEatenAt).getTime()) / 86400000) : 30
  return Math.random() * 10 + (dish.isFavorite ? 3 : 0) + Math.min(days, 30) / 10 - (days <= 3 ? 6 : 0)
}

function pick(dishes, count = 1) {
  return dishes.map(dish => ({ ...dish, _score: scoreDish(dish) }))
    .sort((a, b) => b._score - a._score).slice(0, Math.max(1, Math.min(3, count)))
    .map(({ _score, ...dish }) => dish)
}

module.exports = { pick }

