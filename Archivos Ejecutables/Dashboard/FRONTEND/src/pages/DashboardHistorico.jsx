import { useEffect, useRef, useState } from 'react'
import { Chart, registerables } from 'chart.js'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import HeatmapAQI from '../components/HeatmapAQI'
import { TrendingUp, Calendar, Thermometer, AlertTriangle, Link, Radio, Wind } from 'lucide-react'

Chart.register(...registerables, ChartDataLabels)

const MONTH_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function monthLabel(key) {
  const m = parseInt(key.split('-')[1], 10)
  return MONTH_SHORT[m - 1]
}

function todayStr()    { return new Date().toISOString().slice(0, 10) }
function daysAgoStr(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10) }

function pearson(xs, ys) {
  const n = xs.length
  if (n < 2) return 0
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, dx2 = 0, dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy
  }
  const denom = Math.sqrt(dx2 * dy2)
  return denom === 0 ? 0 : num / denom
}

function aqiCategory(v) {
  if (v <= 50)  return 'Bueno'
  if (v <= 100) return 'Moderado'
  if (v <= 150) return 'Insalubre para grupos sensibles'
  if (v <= 200) return 'Insalubre'
  if (v <= 300) return 'Muy insalubre'
  return 'Peligroso'
}

function pm25Category(v) {
  if (v <= 12)  return 'Bueno'
  if (v <= 35)  return 'Moderado'
  if (v <= 55)  return 'Insalubre (grupos sensibles)'
  if (v <= 150) return 'Insalubre'
  if (v <= 250) return 'Muy insalubre'
  return 'Peligroso'
}

function pm10Category(v) {
  if (v <= 54)  return 'Bueno'
  if (v <= 154) return 'Moderado'
  if (v <= 254) return 'Insalubre (grupos sensibles)'
  if (v <= 354) return 'Insalubre'
  if (v <= 424) return 'Muy insalubre'
  return 'Peligroso'
}

function peakHours(hourly) {
  if (!hourly?.length) return { from: 0, to: 1 }
  const windowSize = 3
  let best = -1, bestIdx = 0
  for (let i = 0; i <= hourly.length - windowSize; i++) {
    const sum = hourly.slice(i, i + windowSize).reduce((a, h) => a + h.aqi, 0)
    if (sum > best) { best = sum; bestIdx = i }
  }
  return { from: hourly[bestIdx].hour, to: hourly[bestIdx + windowSize - 1].hour }
}

function dynMax(arr, margin = 0.22) {
  const max = Math.max(...arr.filter(v => v != null && !isNaN(v)))
  return Math.ceil(max * (1 + margin) / 10) * 10
}

function dynMin(arr, margin = 0.15) {
  const min = Math.min(...arr.filter(v => v != null && !isNaN(v)))
  return Math.floor(min * (1 - margin) / 5) * 5
}

function barColor(v) {
  if (v > 100) return '#e84b4b'
  if (v > 75)  return '#f07c3a'
  if (v > 50)  return '#f5c842'
  return '#34c98c'
}

function makeTooltip(dark) {
  return {
    backgroundColor: dark ? '#1e2535' : '#ffffff',
    borderColor: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
    borderWidth: 1,
    titleColor: dark ? '#e8edf5' : '#2d3436',
    bodyColor: dark ? '#7b8799' : '#4b5357',
    padding: 10,
    cornerRadius: 8,
  }
}

function makeScales(dark) {
  const tick = dark ? '#4a5568' : '#b2bec3'
  const grid = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)'
  return {
    x: { ticks: { color: tick, maxRotation: 0 }, grid: { display: false } },
    y: { ticks: { color: tick }, grid: { color: grid } },
  }
}

const INPUT_STYLE = {
  background: 'var(--hist-input-bg)',
  border: '1px solid var(--hist-border)',
  borderRadius: 8,
  color: 'var(--hist-text)',
  fontSize: 12,
  padding: '5px 10px',
  fontFamily: 'DM Mono, monospace',
  outline: 'none',
  cursor: 'pointer',
}

const PRESETS = [
  { label: '7d',  days: 7 },
  { label: '30d', days: 30 },
  { label: '3m',  days: 90 },
  { label: '6m',  days: 180 },
  { label: '1a',  days: 365 },
]

export default function DashboardHistorico({ theme }) {
  const dark = theme === 'dark'
  const [stats,   setStats]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  // period state — shared across all charts (default: last 30 days)
  const today = todayStr()
  const defaultFrom = daysAgoStr(30)
  const [pendingFrom, setPendingFrom] = useState(defaultFrom)
  const [pendingTo,   setPendingTo]   = useState(today)
  const [appliedFrom, setAppliedFrom] = useState(defaultFrom)
  const [appliedTo,   setAppliedTo]   = useState(today)

  const monthlyAQIRef = useRef(null)
  const hourlyRef     = useRef(null)
  const tempHumRef    = useRef(null)
  const pmRef         = useRef(null)
  const chartsRef     = useRef({})

  function fetchStats(f, t) {
    setLoading(true)
    setError(null)
    let url = '/api/davis?type=historico'
    if (f) url += `&from=${f}`
    if (t) url += `&to=${t}`
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => { setStats(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }

  useEffect(() => { fetchStats(defaultFrom, today) }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  function apply() {
    setAppliedFrom(pendingFrom)
    setAppliedTo(pendingTo)
    fetchStats(pendingFrom, pendingTo)
  }

  function applyPreset(days) {
    const f = daysAgoStr(days)
    const t = todayStr()
    setPendingFrom(f)
    setPendingTo(t)
    setAppliedFrom(f)
    setAppliedTo(t)
    fetchStats(f, t)
  }

  function applyAll() {
    setPendingFrom('')
    setPendingTo('')
    setAppliedFrom('')
    setAppliedTo('')
    fetchStats(null, null)
  }

  useEffect(() => {
    if (!stats) return

    Object.values(chartsRef.current).forEach(c => c.destroy())
    chartsRef.current = {}

    const TOOLTIP = makeTooltip(dark)
    const BASE_SCALES = makeScales(dark)

    const labels   = stats.monthly.map(m => monthLabel(m.month))
    const mAQI     = stats.monthly.map(m => m.aqi)
    const mPM1     = stats.monthly.map(m => m.pm1)
    const mPM25    = stats.monthly.map(m => m.pm25)
    const mPM10    = stats.monthly.map(m => m.pm10)
    const mTemp    = stats.monthly.map(m => m.temp)
    const mHum     = stats.monthly.map(m => m.hum)
    const hLabels  = stats.hourly.map(h => h.hour + 'h')
    const hAQI     = stats.hourly.map(h => h.aqi)
    const hPM25    = stats.hourly.map(h => h.pm25)

    if (monthlyAQIRef.current) {
      chartsRef.current.monthlyAQI = new Chart(monthlyAQIRef.current, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            data: mAQI,
            backgroundColor: mAQI.map(barColor),
            borderRadius: 6,
            borderSkipped: false,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: TOOLTIP,
            datalabels: {
              anchor: 'end',
              align: 'top',
              offset: 2,
              formatter: (v) => Math.round(v),
              font: { family: 'DM Mono, monospace', size: 10, weight: '600' },
              color: (ctx) => barColor(ctx.dataset.data[ctx.dataIndex]),
            },
          },
          scales: { ...BASE_SCALES, y: { ...BASE_SCALES.y, min: 0, max: dynMax(mAQI) } },
        },
      })
    }

    if (hourlyRef.current) {
      const allHourly = [...hAQI, ...hPM25]
      chartsRef.current.hourly = new Chart(hourlyRef.current, {
        type: 'line',
        data: {
          labels: hLabels,
          datasets: [
            {
              data: hAQI,
              borderColor: '#f07c3a',
              backgroundColor: 'rgba(240,124,58,0.08)',
              fill: true, tension: 0.45, pointRadius: 3,
              pointBackgroundColor: '#f07c3a', borderWidth: 2,
            },
            {
              data: hPM25,
              borderColor: '#2cc4b5',
              backgroundColor: 'transparent',
              fill: false, tension: 0.45, pointRadius: 2,
              borderWidth: 1.5, borderDash: [5, 4],
            },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: TOOLTIP,
            datalabels: {
              display: (ctx) => ctx.dataIndex % 3 === 0,
              anchor: 'end',
              align: 'top',
              offset: 2,
              formatter: (v) => Math.round(v),
              font: { family: 'DM Mono, monospace', size: 9 },
              color: (ctx) => ctx.datasetIndex === 0 ? '#f07c3a' : '#2cc4b5',
            },
          },
          scales: { ...BASE_SCALES, y: { ...BASE_SCALES.y, min: Math.max(0, dynMin(allHourly)), max: dynMax(allHourly) } },
        },
      })
    }

    if (tempHumRef.current) {
      chartsRef.current.tempHum = new Chart(tempHumRef.current, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              data: mTemp,
              borderColor: '#f5c842',
              backgroundColor: 'rgba(245,200,66,0.08)',
              fill: true, tension: 0.4, pointRadius: 4,
              pointBackgroundColor: '#f5c842', borderWidth: 2, yAxisID: 'y',
            },
            {
              data: mHum,
              borderColor: '#4d9de0',
              backgroundColor: 'transparent',
              fill: false, tension: 0.4, pointRadius: 4,
              pointBackgroundColor: '#4d9de0', borderWidth: 2,
              borderDash: [6, 4], yAxisID: 'y2',
            },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: TOOLTIP,
            datalabels: {
              anchor: 'end',
              align: 'top',
              offset: 3,
              formatter: (v, ctx) => ctx.datasetIndex === 0 ? v.toFixed(1) + '°' : Math.round(v) + '%',
              font: { family: 'DM Mono, monospace', size: 9 },
              color: (ctx) => ctx.datasetIndex === 0 ? '#f5c842' : '#4d9de0',
            },
          },
          scales: {
            x: { ticks: { color: dark ? '#4a5568' : '#b2bec3' }, grid: { display: false } },
            y:  { ticks: { color: '#f5c842', callback: v => v + '°' }, grid: { color: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)' }, min: dynMin(mTemp), max: dynMax(mTemp) },
            y2: { position: 'right', ticks: { color: '#4d9de0', callback: v => v + '%' }, grid: { display: false }, min: dynMin(mHum), max: Math.min(100, dynMax(mHum)) },
          },
        },
      })
    }

    if (pmRef.current) {
      const allPM = [...mPM1, ...mPM25, ...mPM10]
      chartsRef.current.pm = new Chart(pmRef.current, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { data: mPM1,  backgroundColor: '#9b7ef8', borderRadius: 4, label: 'PM1' },
            { data: mPM25, backgroundColor: '#f07c3a', borderRadius: 4, label: 'PM2.5' },
            { data: mPM10, backgroundColor: '#4d9de0', borderRadius: 4, label: 'PM10' },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: TOOLTIP,
datalabels: {
  anchor: 'end',
  align: 'end',
  
  offset: 2,

  formatter: (v) => Number(v).toFixed(1),

  font: {
    family: 'DM Mono, monospace',
    size: 9,
    weight: '600',
  },

  color: (ctx) =>
    ['#9b7ef8', '#f07c3a', '#4d9de0'][ctx.datasetIndex],
}
          },
          scales: { ...BASE_SCALES, y: { ...BASE_SCALES.y, min: 0, max: dynMax(allPM) } },
        },
      })
    }

    return () => {
      Object.values(chartsRef.current).forEach(c => c.destroy())
      chartsRef.current = {}
    }
  }, [stats, dark])

  if (loading) return <div className="hist-state">Cargando datos históricos…</div>
  if (error)   return <div className="hist-state hist-error-msg">Error al cargar: {error}</div>
  if (!stats)  return null

  const { total, monthly, hourly, distribution, overallAvg } = stats
  const monthLabels = monthly.map(m => monthLabel(m.month))
  const hmBase      = monthly.map(m => m.aqi)

  const mTempArr = monthly.map(m => m.temp)
  const mHumArr  = monthly.map(m => m.hum)
  const mPM1Arr  = monthly.map(m => m.pm1)
  const mPM25Arr = monthly.map(m => m.pm25)
  const mPM10Arr = monthly.map(m => m.pm10)

  const rTemp   = pearson(mTempArr, hmBase)
  const rHum    = pearson(mHumArr,  hmBase)
  const rPM1    = pearson(mPM1Arr,  hmBase)
  const rPM25   = pearson(mPM25Arr, hmBase)
  const rPM10   = pearson(mPM10Arr, hmBase)
  const rClimate = Math.max(Math.abs(rTemp), Math.abs(rHum))
  const rPMmin   = Math.min(Math.abs(rPM1), Math.abs(rPM25), Math.abs(rPM10))

  const peak    = peakHours(hourly)
  const minHour = hourly.reduce((a, b) => b.aqi < a.aqi ? b : a, hourly[0] ?? { hour: 0, aqi: 0 })
  const riskPct = (+distribution.usg + +distribution.unhealthy + +distribution.veryUnhealthy + +(distribution.hazardous ?? 0)).toFixed(1)

  const distRows = [
    { label: 'Bueno',                          range: '0 – 50',    pct: distribution.good,                    color: '#00E676' },
    { label: 'Moderado',                        range: '51 – 100',  pct: distribution.moderate,                color: '#F6D72B' },
    { label: 'Insalubre (grupos sensibles)',     range: '101 – 150', pct: distribution.usg,                    color: '#FF9800' },
    { label: 'Insalubre',                        range: '151 – 200', pct: distribution.unhealthy,              color: '#FF5252' },
    { label: 'Muy insalubre',                    range: '201 – 300', pct: distribution.veryUnhealthy,          color: '#9C27B0' },
    { label: 'Peligroso',                        range: '301+',      pct: distribution.hazardous ?? 0,         color: '#7E0023' },
  ]

  const insights = [
    {
      icon: <TrendingUp size={22} />, title: 'Patrón horario de contaminación',
      text: <>El AQI alcanza su máximo entre las <span style={{color:'#f07c3a',fontFamily:'DM Mono,monospace'}}>{peak.from}–{peak.to} h</span>. El mínimo ocurre alrededor de las <span style={{color:'#34c98c',fontFamily:'DM Mono,monospace'}}>{minHour.hour} h</span> (AQI {minHour.aqi.toFixed(1)}). Patrón derivado de los {total.toLocaleString()} registros históricos.</>,
    },
    {
      icon: <Calendar size={22} />, title: 'Estacionalidad marcada',
      text: <>El mes más limpio tiene AQI <span style={{color:'#34c98c',fontFamily:'DM Mono,monospace'}}>{Math.min(...hmBase).toFixed(1)}</span>. El mes más contaminado alcanza <span style={{color:'#e84b4b',fontFamily:'DM Mono,monospace'}}>{Math.max(...hmBase).toFixed(1)}</span>. Posible influencia de lluvias y quemas estacionales.</>,
    },
    {
      icon: <Thermometer size={22} />, title: 'Relación clima–AQI',
      text: <>La correlación de temperatura con el AQI es <span style={{color:'#9b7ef8',fontFamily:'DM Mono,monospace'}}>r = {rTemp.toFixed(2)}</span> y de humedad <span style={{color:'#9b7ef8',fontFamily:'DM Mono,monospace'}}>r = {rHum.toFixed(2)}</span>. {rClimate < 0.3 ? 'La influencia meteorológica local es baja.' : 'Existe cierta influencia de las condiciones meteorológicas.'}</>,
    },
    {
      icon: <AlertTriangle size={22} />, title: `${(100 - distribution.good).toFixed(0)}% del tiempo con riesgo`,
      text: <>Solo el <span style={{color:'#34c98c',fontFamily:'DM Mono,monospace'}}>{distribution.good}%</span> del tiempo el aire es "Bueno". El <span style={{color:'#f07c3a',fontFamily:'DM Mono,monospace'}}>{riskPct}%</span> está en categorías que requieren acción para grupos sensibles o toda la población.</>,
    },
    {
      icon: <Link size={22} />, title: 'Correlación PM con AQI',
      text: <>PM1 r={rPM1.toFixed(2)}, PM2.5 r={rPM25.toFixed(2)}, PM10 r={rPM10.toFixed(2)} con el AQI mensual. {rPMmin > 0.85 ? 'Alta correlación indica una fuente de emisión dominante.' : 'Las fracciones siguen tendencias parcialmente independientes.'}</>,
    },
    {
      icon: <Radio size={22} />, title: 'Cobertura del dataset',
      text: <><span style={{color:'#2cc4b5',fontFamily:'DM Mono,monospace'}}>{total.toLocaleString()} registros</span> a intervalos de 15 minutos sobre {monthly.length} meses. Sin valores nulos en ninguna variable del sensor.</>,
    },
  ]

  return (
    <div className="hist-wrap">

      <div className="hist-header">
        <div className="hist-header-left">
          <div className="hist-icon"><Wind size={28} /></div>
          <div>
            <div className="hist-title">Monitor de Calidad del Aire</div>
            <div className="hist-sub">Sensor Davis AirLink · histórico</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="hist-badge-green">{total.toLocaleString()} registros</div>
          <div className="hist-badge-blue">NOM-172-SEMARNAT-2023</div>
        </div>
      </div>

      {/* ── Period controls (shared across all charts) ── */}
      <div style={{
        background: 'var(--hist-period-bg)',
        border: '1px solid var(--hist-border)',
        borderRadius: 14,
        padding: '14px 20px',
        margin: '0 0 20px 0',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-end',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10, color: 'var(--hist-text-muted)', letterSpacing: '0.8px', textTransform: 'uppercase' }}>Desde</span>
          <input
            type="date"
            value={pendingFrom}
            max={pendingTo}
            onChange={e => setPendingFrom(e.target.value)}
            style={INPUT_STYLE}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10, color: 'var(--hist-text-muted)', letterSpacing: '0.8px', textTransform: 'uppercase' }}>Hasta</span>
          <input
            type="date"
            value={pendingTo}
            min={pendingFrom}
            max={todayStr()}
            onChange={e => setPendingTo(e.target.value)}
            style={INPUT_STYLE}
          />
        </div>

        {/* Quick presets */}
        <div style={{ display: 'flex', gap: 4 }}>
          {PRESETS.map(({ label, days }) => (
            <button
              key={label}
              onClick={() => applyPreset(days)}
              style={{
                background: 'transparent',
                border: '1px solid var(--hist-border)',
                borderRadius: 8,
                color: 'var(--hist-text-muted)',
                fontSize: 11,
                fontWeight: 700,
                padding: '5px 10px',
                cursor: 'pointer',
                fontFamily: 'DM Mono, monospace',
                transition: 'border-color 0.2s, color 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--blue)'; e.currentTarget.style.color = 'var(--hist-text)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--hist-border)'; e.currentTarget.style.color = 'var(--hist-text-muted)' }}
            >
              {label}
            </button>
          ))}
          <button
            onClick={applyAll}
            style={{
              background: 'transparent',
              border: '1px solid var(--hist-border)',
              borderRadius: 8,
              color: 'var(--hist-text-muted)',
              fontSize: 11,
              fontWeight: 700,
              padding: '5px 10px',
              cursor: 'pointer',
              fontFamily: 'DM Mono, monospace',
              transition: 'border-color 0.2s, color 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#9b7ef8'; e.currentTarget.style.color = 'var(--hist-text)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--hist-border)'; e.currentTarget.style.color = 'var(--hist-text-muted)' }}
          >
            todo
          </button>
        </div>

        <button
          onClick={apply}
          style={{
            background: '#2d62ed',
            border: 'none',
            borderRadius: 10,
            color: '#fff',
            fontSize: 12,
            fontWeight: 700,
            padding: '8px 20px',
            cursor: 'pointer',
            fontFamily: 'DM Sans, sans-serif',
          }}
        >
          Aplicar
        </button>

        <span style={{ fontSize: 11, color: 'var(--hist-text-sub)', fontFamily: 'DM Mono, monospace' }}>
          {appliedFrom && appliedTo ? `${appliedFrom} → ${appliedTo}` : 'todos los registros'}
        </span>
      </div>

      <div className="hist-main">

        <div className="hist-section-label">Resumen general</div>
        <div className="hist-metrics-grid">
          <div className="hist-metric-card" style={{ '--hist-accent': '#f07c3a' }}>
            <div className="hist-metric-label">AQI Promedio</div>
            <div className="hist-metric-value" style={{ color: barColor(overallAvg.aqi) }}>{overallAvg.aqi}</div>
            <div className="hist-metric-sub">Categoría: {aqiCategory(overallAvg.aqi)}</div>
          </div>
          <div className="hist-metric-card" style={{ '--hist-accent': '#e84b4b' }}>
            <div className="hist-metric-label">PM2.5 Promedio</div>
            <div className="hist-metric-value">{overallAvg.pm25}<span>µg/m³</span></div>
            <div className="hist-metric-sub">Nivel: {pm25Category(overallAvg.pm25)}</div>
          </div>
          <div className="hist-metric-card" style={{ '--hist-accent': '#9b7ef8' }}>
            <div className="hist-metric-label">PM10 Promedio</div>
            <div className="hist-metric-value">{overallAvg.pm10}<span>µg/m³</span></div>
            <div className="hist-metric-sub">Nivel: {pm10Category(overallAvg.pm10)}</div>
          </div>
          <div className="hist-metric-card" style={{ '--hist-accent': '#2cc4b5' }}>
            <div className="hist-metric-label">Temperatura Promedio</div>
            <div className="hist-metric-value">{overallAvg.temp}<span>°C</span></div>
            <div className="hist-metric-sub">Humedad media: {overallAvg.hum}%</div>
          </div>
        </div>

        <div className="hist-section-label">Calidad del aire</div>
        <div className="hist-grid-2">

          <div className="hist-chart-card">
            <div className="hist-chart-title">Distribución por categoría AQI</div>
            <div className="hist-chart-sub">Porcentaje del tiempo total en cada banda</div>
            <div style={{ marginTop: 8 }}>
              {distRows.map(({ label, range, pct, color }) => (
                <div key={label} className="hist-dist-row">
                  <div className="hist-dist-label">{label} <span style={{ color: '#888', fontSize: '0.8em' }}>{range}</span></div>
                  <div className="hist-dist-track">
                    <div className="hist-dist-fill" style={{ width: `${Math.max(pct, 0.5)}%`, background: color }}>
                      {pct}
                    </div>
                  </div>
                  <div className="hist-dist-pct" style={{ color }}>{pct}%</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 20 }}>
              <div className="hist-aqi-scale">
                {[['#00E676',50],['#F6D72B',50],['#FF9800',50],['#FF5252',50],['#9C27B0',100],['#7E0023',200]].map(([bg, flex]) => (
                  <div key={bg} style={{ flex, background: bg }} />
                ))}
              </div>
              <div className="hist-aqi-scale-labels">
                {['0','50','100','150','200','300','500'].map(l => <span key={l}>{l}</span>)}
              </div>
            </div>
          </div>

          <div className="hist-chart-card">
            <div className="hist-chart-title">AQI promedio mensual</div>
            <div className="hist-chart-sub">Promedio del índice de calidad del aire por mes</div>
            <div className="hist-legend">
              <div className="hist-legend-item"><div className="hist-legend-dot" style={{ background: '#4d9de0' }} />AQI mensual</div>
            </div>
            <div style={{ position: 'relative', height: 210 }}>
              <canvas ref={monthlyAQIRef} />
            </div>
          </div>
        </div>

        <div className="hist-section-label">Patrones temporales</div>
        <div className="hist-grid-2">

          <div className="hist-chart-card">
            <div className="hist-chart-title">Patrón horario — AQI y PM2.5</div>
            <div className="hist-chart-sub">Promedio por hora del día sobre todo el periodo</div>
            <div className="hist-legend">
              <div className="hist-legend-item"><div className="hist-legend-dot" style={{ background: '#f07c3a' }} />AQI</div>
              <div className="hist-legend-item"><div className="hist-legend-dot" style={{ background: '#2cc4b5', backgroundColor: 'transparent', outline: '1px dashed #2cc4b5' }} />PM2.5 µg/m³</div>
            </div>
            <div style={{ position: 'relative', height: 210 }}>
              <canvas ref={hourlyRef} />
            </div>
          </div>

          <div className="hist-chart-card">
            <div className="hist-chart-title">Temperatura y humedad mensual</div>
            <div className="hist-chart-sub">Condiciones meteorológicas por mes</div>
            <div className="hist-legend">
              <div className="hist-legend-item"><div className="hist-legend-dot" style={{ background: '#f5c842' }} />Temperatura °C</div>
              <div className="hist-legend-item"><div className="hist-legend-dot" style={{ background: '#4d9de0' }} />Humedad %</div>
            </div>
            <div style={{ position: 'relative', height: 210 }}>
              <canvas ref={tempHumRef} />
            </div>
          </div>
        </div>

        <div className="hist-section-label">Partículas en suspensión</div>
        <div className="hist-chart-card">
          <div className="hist-chart-title">PM1, PM2.5 y PM10 mensuales (µg/m³)</div>
          <div className="hist-chart-sub">Concentración promedio de partículas por fracción de tamaño</div>
          <div className="hist-legend">
            <div className="hist-legend-item"><div className="hist-legend-dot" style={{ background: '#9b7ef8' }} />PM1</div>
            <div className="hist-legend-item"><div className="hist-legend-dot" style={{ background: '#f07c3a' }} />PM2.5</div>
            <div className="hist-legend-item"><div className="hist-legend-dot" style={{ background: '#4d9de0' }} />PM10</div>
          </div>
          <div style={{ position: 'relative', height: 200 }}>
            <canvas ref={pmRef} />
          </div>
        </div>

        <div className="hist-section-label">Mapa de calor — AQI por hora y período</div>
        <div className="hist-chart-card">
          <div className="hist-chart-title">Intensidad horaria × período seleccionado</div>
          <div className="hist-chart-sub">Cada celda muestra el AQI promedio para esa combinación hora–día/mes.</div>
          <div style={{ marginTop: 14 }}>
            <HeatmapAQI from={appliedFrom} to={appliedTo} theme={theme} />
          </div>
        </div>

        <div className="hist-section-label">Hallazgos clave</div>
        <div className="hist-insight-grid">
          {insights.map(({ icon, title, text }) => (
            <div key={title} className="hist-insight-card">
              <div className="hist-insight-icon">{icon}</div>
              <div className="hist-insight-title">{title}</div>
              <div className="hist-insight-text">{text}</div>
            </div>
          ))}
        </div>

      </div>

      <div className="hist-footer">
        <div className="hist-footer-text">Sensor Davis AirLink · WeatherLink API · {monthly[0]?.month} – {monthly[monthly.length - 1]?.month}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="hist-badge-blue">NOM-172-SEMARNAT-2023</div>
          <div className="hist-footer-text" style={{ marginLeft: 8 }}>Generado con datos históricos del sensor Davis</div>
        </div>
      </div>
    </div>  
  )
}