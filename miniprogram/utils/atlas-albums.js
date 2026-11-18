const map = require('./atlas-map')

function sortPhotos(photos) {
  return [...photos].sort(
    (a, b) =>
      String(b.takenOn || '').localeCompare(String(a.takenOn || '')) || Number(b.id) - Number(a.id),
  )
}

// Same POI name plus nearby coordinates; never merge identically named distant places.
function nearby(a, b) {
  const radians = Math.PI / 180
  const dy = (Number(a.latitude) - Number(b.latitude)) * 111.2
  const dx =
    (Number(a.longitude) - Number(b.longitude)) * 111.2 * Math.cos(Number(a.latitude) * radians)
  return Math.hypot(dx, dy) < 1
}
function albums(photos) {
  const places = []
  for (const photo of sortPhotos(photos)) {
    if (!map.position(photo.latitude, photo.longitude)) continue
    const name = (photo.city || '未命名地点').trim()
    const province = photo.provinceName || map.provinceForPhoto(photo) || '其他地点'
    let place = places.find(
      (item) => item.name === name && item.province === province && nearby(item, photo),
    )
    if (!place) {
      place = {
        id: String(photo.id),
        name,
        province,
        latitude: photo.latitude,
        longitude: photo.longitude,
        previewUrl: photo.previewUrl,
        photos: [],
        count: 0,
      }
      places.push(place)
    }
    place.photos.push(photo)
    place.count++
  }
  const regions = []
  for (const place of places) {
    let region = regions.find((item) => item.name === place.province)
    if (!region) {
      region = {
        id: place.province,
        name: place.province,
        province: place.province,
        latitude: place.latitude,
        longitude: place.longitude,
        previewUrl: place.previewUrl,
        places: [],
        photos: [],
        count: 0,
      }
      regions.push(region)
    }
    region.places.push(place)
    region.photos.push(...place.photos)
    region.count += place.count
  }
  const cities = []
  for (const region of regions) {
    region.photos = sortPhotos(region.photos)
    region.cities = []
    for (const photo of region.photos) {
      const name = photo.cityName || '待识别城市'
      const id = `city:${photo.cityCode || region.name + ':' + name}`
      let city = region.cities.find((item) => item.id === id)
      if (!city) {
        city = {
          id,
          name,
          cityCode: photo.cityCode || '',
          province: region.name,
          previewUrl: photo.previewUrl,
          latitude: photo.cityLatitude ?? photo.latitude,
          longitude: photo.cityLongitude ?? photo.longitude,
          photos: [],
          count: 0,
        }
        region.cities.push(city)
        cities.push(city)
      }
      city.photos.push(photo)
      city.count++
    }
  }
  return { places, regions, cities }
}
function bounds(name) {
  const province = map.provinces.find((item) => item.name === name)
  if (!province) return { x: 0, y: 0, width: 600, height: 465 }
  // Mainland/largest island, avoiding remote islands forcing an excessively distant view.
  const rings = province.polygons.map((polygon) => polygon[0])
  const box = (ring) => {
    const xs = ring.map((p) => p[0]),
      ys = ring.map((p) => p[1])
    const x = Math.min(...xs),
      y = Math.min(...ys)
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
  }
  return rings.map(box).sort((a, b) => b.width * b.height - a.width * a.height)[0]
}
module.exports = { albums, bounds, sortPhotos }
