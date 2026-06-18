import { useEffect } from 'react'
import { Leaf, Wind, Cloud, Droplets, Thermometer } from 'lucide-react'
import {
  aqiColor, aqiLabel, aqiActiveIndex, aqiScale,
  pm25Color, pm25Label, pm25ActiveIndex, pm25Scale,
  pm10Color, pm10Label, pm10ActiveIndex, pm10Scale,
  humColor, humLabel, humActiveIndex, humScale,
  tempColor, tempLabel, tempActiveIndex, tempScale,
} from '../utils/aqi'

function getInfo(type, data) {
  switch (type) {
    case 'aqi':
      return {
        icon: <Leaf size={32} />, title: 'AQI', subtitle: 'Índice de Calidad del Aire', unit: '',
        desc: 'El AQI (Air Quality Index) es una escala numérica que indica qué tan limpio o contaminado está el aire. Combina las concentraciones de PM2.5, PM10, ozono, CO y otros contaminantes en un único valor comprensible.\nFuente: Estándares SEMARNAT 2019.',
        scale: aqiScale,
        value: Math.round(data.aqi),
        color: aqiColor(data.aqi),
        badge: aqiLabel(data.aqi),
        activeIdx: aqiActiveIndex(data.aqi),
      }
    case 'pm25':
      return {
        icon: <Wind size={32} />, title: 'PM 2.5', subtitle: 'Partículas finas suspendidas', unit: 'µg/m³',
        desc: 'Las PM2.5 son partículas con diámetro inferior a 2.5 micrómetros. Penetran profundamente en los pulmones y pueden pasar al torrente sanguíneo.\nFuente: Estándares SEMARNAT 2019.',
        scale: pm25Scale,
        value: data.pm25.toFixed(1),
        color: pm25Color(data.pm25),
        badge: pm25Label(data.pm25),
        activeIdx: pm25ActiveIndex(data.pm25),
      }
    case 'pm10':
      return {
        icon: <Cloud size={32} />, title: 'PM 10', subtitle: 'Partículas gruesas suspendidas', unit: 'µg/m³',
        desc: 'Las PM10 incluyen partículas de entre 2.5 y 10 micrómetros. Afectan el sistema respiratorio superior.\nFuente: Estándares SEMARNAT 2019.',
        scale: pm10Scale,
        value: data.pm10.toFixed(1),
        color: pm10Color(data.pm10),
        badge: pm10Label(data.pm10),
        activeIdx: pm10ActiveIndex(data.pm10),
      }
    case 'humedad':
      return {
        icon: <Droplets size={32} />, title: 'Humedad', subtitle: 'Humedad relativa del aire', unit: '%',
        desc: 'La humedad relativa indica el porcentaje de vapor de agua presente en el aire. Niveles entre 40% y 60% son óptimos para el confort y la salud respiratoria.',
        scale: humScale,
        value: Math.round(data.humedad),
        color: humColor(data.humedad),
        badge: humLabel(data.humedad),
        activeIdx: humActiveIndex(data.humedad),
      }
    case 'temperatura':
      return {
        icon: <Thermometer size={32} />, title: 'Temperatura', subtitle: 'Temperatura ambiente', unit: '°C',
        desc: 'La temperatura influye en el confort térmico y la calidad del aire. Entre 18°C y 24°C es óptima para la mayoría de las personas.\nFuente: NWS.',
        scale: tempScale,
        value: data.temperatura.toFixed(1),
        color: tempColor(data.temperatura),
        badge: tempLabel(data.temperatura),
        activeIdx: tempActiveIndex(data.temperatura),
      }
    default:
      return null
  }
}

export default function DetailModal({ type, data, onClose }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', handler)
    }
  }, [onClose])

  const info = getInfo(type, data)
  if (!info) return null

  return (
    <div
      className="modal-overlay open"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="modal">
        <button className="modal-close" onClick={onClose}>✕</button>

        <div className="modal-header">
          <div className="modal-icon" style={{ color: info.color }}>{info.icon}</div>
          <div>
            <div className="modal-title">{info.title}</div>
            <div className="modal-subtitle">{info.subtitle}</div>
          </div>
        </div>

        <div className="modal-value-row">
          <span className="modal-value" style={{ color: info.color }}>{info.value}</span>
          <span className="modal-unit">{info.unit}</span>
        </div>

        <div
          className="modal-badge"
          style={{ background: `${info.color}22`, color: info.color }}
        >
          {info.badge}
        </div>

        <p className="modal-desc">{info.desc}</p>

        <div className="modal-scale-title">Escala de referencia</div>
        <div className="modal-scale">
          {info.scale.map((s, i) => (
            <div
              key={i}
              className="scale-row"
              style={{
                background: `${s.color}${i === info.activeIdx ? '22' : '0D'}`,
                color: i === info.activeIdx ? s.color : 'var(--text-sub)',
                outline: i === info.activeIdx ? `2px solid ${s.color}` : 'none',
                fontWeight: i === info.activeIdx ? 800 : 600,
              }}
            >
              <div className="scale-dot" style={{ background: s.color }} />
              <span>{s.label}</span>
              <span className="scale-range">{s.range}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
