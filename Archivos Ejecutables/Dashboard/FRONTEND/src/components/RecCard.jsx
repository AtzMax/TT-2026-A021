import { useState, useEffect } from 'react'
import { Megaphone, Lightbulb } from 'lucide-react'
import { fetchRecomendacion, fetchPrediccion } from '../api/davis'

const POLL_MS = 30_000

const NIVEL_STYLE = {
  0: { bg: 'var(--rec-good-bg)',    color: '#2F855A' },
  1: { bg: 'var(--rec-mod-bg)',     color: '#B45309' },
  2: { bg: 'var(--rec-warn-bg)',    color: '#E65100' },
  3: { bg: 'var(--rec-danger-bg)',  color: '#C53030' },
}

function nivelDeAqi(aqi) {
  if (aqi > 150) return 3
  if (aqi > 100) return 2
  if (aqi > 50)  return 1
  return 0
}

function fallbackFromAqi(aqi) {
  if (aqi > 150) return { nivel: 3, msg: 'Calidad del aire crítica. Evite actividades físicas y use purificadores de aire.' }
  if (aqi > 100) return { nivel: 2, msg: 'Nivel insalubre para grupos sensibles. Limiten el tiempo al aire libre.' }
  if (aqi > 50)  return { nivel: 1, msg: 'Nivel moderado. Personas sensibles deben limitar actividades al aire libre.' }
  return           { nivel: 0, msg: 'Calidad de aire excelente. El ambiente es seguro para todas las personas.' }
}

// Suma 60 min al timestamp "2026-05-08 15:18:00" → "08/05 16:18"
function calcularHoraPredicha(ts) {
  const iso = ts.replace(' ', 'T')
  const d = new Date(iso)
  d.setMinutes(d.getMinutes() + 60)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mo} ${hh}:${mm}`
}

export default function RecCard({ aqi }) {
  const [rec,       setRec]       = useState(null)
  const [prediccion, setPrediccion] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [recResult, predResult] = await Promise.allSettled([
        fetchRecomendacion(),
        fetchPrediccion(),
      ])
      if (cancelled) return
      if (recResult.status === 'fulfilled')  setRec(recResult.value)
      else                                   setRec(null)
      if (predResult.status === 'fulfilled') setPrediccion(predResult.value)
      else                                   setPrediccion(null)
    }

    load()
    const id = setInterval(load, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // ── Determinar nivel efectivo para el estilo ─────────────────
  const aqiActual   = aqi
  const aqiPredicho = prediccion?.aqi_predicho ?? null

  // Usa la recomendación del servidor si está disponible;
  // si no, deriva el nivel del AQI actual o predicho (el mayor)
  const nivelActual   = rec ? Math.min(rec.nivel_alerta, 3) : nivelDeAqi(aqiActual)
  const nivelPredicho = aqiPredicho !== null ? nivelDeAqi(aqiPredicho) : nivelActual
  const nivelEfectivo = Math.max(nivelActual, nivelPredicho)

  const { bg, color } = NIVEL_STYLE[nivelEfectivo]

  // ── Indicador de tendencia basado en predicción ──────────────
  function TendenciaPrediccion() {
    if (aqiPredicho === null) return null
    const diff = aqiPredicho - aqiActual
    const icono = diff > 10 ? '↑' : diff < -10 ? '↓' : '→'
    const colorTend = diff > 10 ? '#C53030' : diff < -10 ? '#2F855A' : '#B45309'
    const horaLabel = prediccion?.timestamp ? calcularHoraPredicha(prediccion.timestamp) : '+1 h'

    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginTop: 8, padding: '6px 10px',
        background: `${colorTend}18`, borderRadius: 8,
        border: `1px solid ${colorTend}33`,
      }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: colorTend }}>{icono}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, color: colorTend,
            fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            Predicción +1h · {horaLabel}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-dark)', fontFamily: 'DM Mono, monospace' }}>
            AQI estimado: <strong>{aqiPredicho}</strong>
            {prediccion?.categoria && (
              <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>— {prediccion.categoria.trim()}</span>
            )}
          </span>
          {prediccion?.confianza && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>
              {prediccion.confianza}
            </span>
          )}
        </div>
      </div>
    )
  }

  // ── Render con datos del servidor de recomendaciones ─────────
  if (rec) {
    const iconoTendencia = rec.icono_tendencia ?? '→'
    const delta = rec.delta_aqi != null ? rec.delta_aqi.toFixed(1) : null

    return (
      <div className="rec-card" style={{ background: bg, borderColor: `${color}33` }}>
        <div className="rec-icon"><Megaphone size={22} /></div>
        <div className="rec-body">
          <div className="rec-label" style={{ color }}>
            Recomendación
            {delta !== null && (
              <span className="rec-tendencia" style={{ color }}>
                {iconoTendencia} {delta > 0 ? '+' : ''}{delta} AQI
              </span>
            )}
          </div>
          <div className="rec-text">{rec.mensaje_general}</div>
          {rec.mensaje_expuesto && rec.nivel_alerta >= 1 && (
            <div className="rec-exposed" style={{ color }}>{rec.mensaje_expuesto}</div>
          )}
          {rec.contexto_activo && (
            <div className="rec-contexto">{rec.contexto_activo}</div>
          )}
          <TendenciaPrediccion />
        </div>
      </div>
    )
  }

  // ── Fallback usando AQI actual + predicción ──────────────────
  const { msg } = fallbackFromAqi(aqiActual)
  const RecIcon = nivelEfectivo === 0 ? Lightbulb : Megaphone

  return (
    <div className="rec-card" style={{ background: bg, borderColor: `${color}33` }}>
      <div className="rec-icon"><RecIcon size={22} /></div>
      <div className="rec-body">
        <div className="rec-label" style={{ color }}>Recomendación</div>
        <div className="rec-text">{msg}</div>
        <TendenciaPrediccion />
      </div>
    </div>
  )
}
