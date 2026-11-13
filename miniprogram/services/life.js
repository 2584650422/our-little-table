const { request } = require('./api')
module.exports = {
  summary: () => request({ url: '/api/life/summary' }),
  saveHome: (data) => request({ url: '/api/life/home', method: 'PUT', data }),
  events: () => request({ url: '/api/life/events' }),
  calendar: (month) => request({ url: '/api/life/calendar', data: { month } }),
  anniversary: (date) => request({ url: '/api/life/anniversary', method: 'PUT', data: { date } }),
  saveEvent: (data, id) =>
    request({ url: '/api/life/events' + (id ? '/' + id : ''), method: id ? 'PUT' : 'POST', data }),
  deleteEvent: (id) => request({ url: '/api/life/events/' + id, method: 'DELETE' }),
  photos: (beforeId) => request({ url: '/api/life/photos', data: { beforeId: beforeId || 0 } }),
  photo: (id) => request({ url: '/api/life/photos/' + id }),
  updatePhoto: (id, data) => request({ url: '/api/life/photos/' + id, method: 'PUT', data }),
  addPhoto: (data) => request({ url: '/api/life/photos', method: 'POST', data }),
  deletePhoto: (id) => request({ url: '/api/life/photos/' + id, method: 'DELETE' }),
}
