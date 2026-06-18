export const aqiScale = [
  { label: 'Bueno', range: '0 – 50', color: '#00E676' },
  { label: 'Moderado', range: '51 – 100', color: '#F6D72B' },
  { label: 'Insalubre (grupos sensibles)', range: '101 – 150', color: '#FF9800' },
  { label: 'Insalubre', range: '151 – 200', color: '#FF5252' },
  { label: 'Muy insalubre', range: '201 – 300', color: '#9C27B0' },
  { label: 'Peligroso', range: '301+', color: '#7E0023' },
]

export const pm25Scale = [
  { label: 'Bueno', range: '0 – 12', color: '#00E676' },
  { label: 'Moderado', range: '12.1 – 35', color: '#F6D72B' },
  { label: 'Insalubre (sensibles)', range: '35.1 – 55', color: '#FF9800' },
  { label: 'Insalubre', range: '55.1 – 150', color: '#FF5252' },
  { label: 'Muy insalubre', range: '150.1 – 250', color: '#9C27B0' },
  { label: 'Peligroso', range: '250.1+', color: '#7E0023' },
]

export const pm10Scale = [
  { label: 'Bueno', range: '0 – 54', color: '#00E676' },
  { label: 'Moderado', range: '55 – 154', color: '#F6D72B' },
  { label: 'Insalubre (sensibles)', range: '155 – 254', color: '#FF9800' },
  { label: 'Insalubre', range: '255 – 354', color: '#FF5252' },
  { label: 'Muy insalubre', range: '355 – 424', color: '#9C27B0' },
  { label: 'Peligroso', range: '425+', color: '#7E0023' },
]

export const humScale = [
  { label: 'Muy seco', range: '< 20%', color: '#FF9800' },
  { label: 'Seco', range: '20 – 39%', color: '#F6D72B' },
  { label: 'Confortable', range: '40 – 60%', color: '#00E676' },
  { label: 'Húmedo', range: '61 – 80%', color: '#F6D72B' },
  { label: 'Muy húmedo', range: '> 80%', color: '#FF9800' },
]

export const tempScale = [
  { label: 'Muy frío', range: '< 10°C', color: '#2D62ED' },
  { label: 'Fresco', range: '10 – 17°C', color: '#00BCD4' },
  { label: 'Confortable', range: '18 – 24°C', color: '#00E676' },
  { label: 'Cálido', range: '25 – 32°C', color: '#FF9800' },
  { label: 'Muy caliente', range: '> 32°C', color: '#FF5252' },
]

export function aqiColor(v) {
  if (v <= 50) return '#00E676'
  if (v <= 100) return '#F6D72B'
  if (v <= 150) return '#FF9800'
  if (v <= 200) return '#FF5252'
  if (v <= 300) return '#9C27B0'
  return '#7E0023'
}

export function aqiLabel(v) {
  if (v <= 50) return 'Bueno'
  if (v <= 100) return 'Moderado'
  if (v <= 150) return 'Insalubre (Sensibles)'
  if (v <= 200) return 'Insalubre'
  if (v <= 300) return 'Muy Insalubre'
  return 'Peligroso'
}

export function aqiActiveIndex(v) {
  if (v <= 50) return 0
  if (v <= 100) return 1
  if (v <= 150) return 2
  if (v <= 200) return 3
  if (v <= 300) return 4
  return 5
}

export function pm25Color(v) {
  if (v <= 12) return '#00E676'
  if (v <= 35) return '#F6D72B'
  if (v <= 55) return '#FF9800'
  if (v <= 150) return '#FF5252'
  if (v <= 250) return '#9C27B0'
  return '#7E0023'
}

export function pm25Label(v) {
  if (v <= 12) return 'Nivel seguro'
  if (v <= 35) return 'Moderado'
  if (v <= 55) return 'Insalubre (sensibles)'
  if (v <= 150) return 'Insalubre'
  if (v <= 250) return 'Muy insalubre'
  return 'Peligroso'
}

export function pm25ActiveIndex(v) {
  if (v <= 12) return 0
  if (v <= 35) return 1
  if (v <= 55) return 2
  if (v <= 150) return 3
  if (v <= 250) return 4
  return 5
}

export function pm10Color(v) {
  if (v <= 54) return '#00E676'
  if (v <= 154) return '#F6D72B'
  if (v <= 254) return '#FF9800'
  if (v <= 354) return '#FF5252'
  if (v <= 424) return '#9C27B0'
  return '#7E0023'
}

export function pm10Label(v) {
  if (v <= 54) return 'Nivel seguro'
  if (v <= 154) return 'Moderado'
  if (v <= 254) return 'Insalubre (sensibles)'
  if (v <= 354) return 'Insalubre'
  if (v <= 424) return 'Muy insalubre'
  return 'Peligroso'
}

export function pm10ActiveIndex(v) {
  if (v <= 54) return 0
  if (v <= 154) return 1
  if (v <= 254) return 2
  if (v <= 354) return 3
  if (v <= 424) return 4
  return 5
}

export function humColor(v) {
  if (v >= 40 && v <= 60) return '#00E676'
  if (v < 20 || v > 80) return '#FF9800'
  return '#F6D72B'
}

export function humLabel(v) {
  if (v < 20) return 'Muy seco'
  if (v < 40) return 'Seco'
  if (v <= 60) return 'Confortable'
  if (v <= 80) return 'Húmedo'
  return 'Muy húmedo'
}

export function humActiveIndex(v) {
  if (v < 20) return 0
  if (v < 40) return 1
  if (v <= 60) return 2
  if (v <= 80) return 3
  return 4
}

export function tempColor(v) {
  if (v < 10) return '#2D62ED'
  if (v < 18) return '#00BCD4'
  if (v <= 24) return '#00E676'
  if (v <= 32) return '#FF9800'
  return '#FF5252'
}

export function tempLabel(v) {
  if (v < 10) return 'Muy frío'
  if (v < 18) return 'Fresco'
  if (v <= 24) return 'Confortable'
  if (v <= 32) return 'Cálido'
  return 'Muy caliente'
}

export function tempActiveIndex(v) {
  if (v < 10) return 0
  if (v < 18) return 1
  if (v <= 24) return 2
  if (v <= 32) return 3
  return 4
}

export function generateNotifications(data, prevLevels) {
  const newLevels = {
    aqi: aqiActiveIndex(data.aqi),
    pm25: pm25ActiveIndex(data.pm25),
    pm10: pm10ActiveIndex(data.pm10),
  }

  const notifications = []
  const now = new Date()

  if (newLevels.aqi >= 2 && newLevels.aqi !== prevLevels.aqi) {
    notifications.push({
      id: `aqi-${Date.now()}`,
      type: newLevels.aqi >= 3 ? 'danger' : 'warning',
      icon: 'leaf',
      title: 'Calidad del Aire',
      message: `AQI ${Math.round(data.aqi)} · ${aqiLabel(data.aqi)}`,
      time: now,
      read: false,
    })
  }

  if (newLevels.pm25 >= 2 && newLevels.pm25 !== prevLevels.pm25) {
    notifications.push({
      id: `pm25-${Date.now() + 1}`,
      type: 'warning',
      icon: 'wind',
      title: 'PM 2.5 Elevado',
      message: `${data.pm25.toFixed(1)} µg/m³ · ${pm25Label(data.pm25)}`,
      time: now,
      read: false,
    })
  }

  if (newLevels.pm10 >= 2 && newLevels.pm10 !== prevLevels.pm10) {
    notifications.push({
      id: `pm10-${Date.now() + 2}`,
      type: 'warning',
      icon: 'cloud',
      title: 'PM 10 Elevado',
      message: `${data.pm10.toFixed(1)} µg/m³ · ${pm10Label(data.pm10)}`,
      time: now,
      read: false,
    })
  }

  return { notifications, newLevels }
}
