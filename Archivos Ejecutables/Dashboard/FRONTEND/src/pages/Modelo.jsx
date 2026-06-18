import { useState, useEffect, useRef } from 'react'
import { Chart, registerables } from 'chart.js'
import { Bot, BarChart2, Brain, Info, Radio, TrendingUp, RefreshCw, Thermometer } from 'lucide-react'

Chart.register(...registerables)

const API_PREDICCION = 'http://localhost:3001/api/prediccion'
const API_MODELO     = 'http://localhost:3001/api/modelo'

// ── Muestra el timestamp exacto de Supabase sin convertir zona horaria
// "2026-05-08 15:18:00" → "2026-05-08 15:18"
function formatTimestamp(ts) {
  return ts.slice(0, 16)
}

// ── Suma 60 min al timestamp de Supabase sin convertir zona horaria
// "2026-05-08 15:18:00" → "08/05 16:18"
function calcularHoraPredicha(ts) {
  const d = new Date(ts.replace(' ', 'T'))
  d.setMinutes(d.getMinutes() + 60)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mo} ${hh}:${mm}`
}

// ── Para la gráfica del test set — muestra solo hora:minuto
// "2026-04-29 06:20:00" → "06:20"
//function formatFechaHora(str) {
  //return str.slice(11, 16)
//}

// Muestra "29/04 06:20"
function formatFechaHora(str) {
  const fecha = str.slice(5, 10).split('-').reverse().join('/')  // "04-29" → "29/04"
  const hora  = str.slice(11, 16)                                // "06:20"
  return `${fecha} ${hora}`
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

export default function Modelo({ theme }) {
  const dark = theme === 'dark'

  const [prediccion, setPrediccion] = useState(null)
  const [testData,   setTestData]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [updated,    setUpdated]    = useState(null)

  const testChartRef  = useRef(null)
  const testChartInst = useRef(null)

  // ── Fetch predicción ──────────────────────────────────────
  const fetchPrediccion = async () => {
    try {
      const res = await fetch(API_PREDICCION)
      if (!res.ok) throw new Error(`Predicción: ${res.status}`)
      const pred = await res.json()
      setPrediccion(pred)
      setUpdated(new Date().toLocaleTimeString('es-MX'))
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Fetch datos del test set (estático, una sola vez) ─────
  useEffect(() => {
    fetch(API_MODELO)
      .then(r => r.json())
      .then(data => setTestData(data))
      .catch(err => console.error('Error cargando datos del modelo:', err.message))
  }, [])

  useEffect(() => {
    fetchPrediccion()
    const intervalo = setInterval(fetchPrediccion, 5 * 60 * 1000)
    return () => clearInterval(intervalo)
  }, [])

  // ── Gráfica Real vs Predicho (test set) ──────────────────
  useEffect(() => {
    if (!testChartRef.current || !testData.length) return

    if (testChartInst.current) {
      testChartInst.current.destroy()
      testChartInst.current = null
    }

    const tick    = dark ? '#4a5568' : '#b2bec3'
    const grid    = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)'
    const TOOLTIP = makeTooltip(dark)

    const MAX_PUNTOS = 200
    const step    = Math.max(1, Math.floor(testData.length / MAX_PUNTOS))
    const muestra = testData.filter((_, i) => i % step === 0)

    const labels    = muestra.map(d => formatFechaHora(d.fecha_hora))
    const yReal     = muestra.map(d => d.y_real)
    const yPredicho = muestra.map(d => d.y_predicho)

    testChartInst.current = new Chart(testChartRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'AQI Real',
            data: yReal,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37,99,235,0.07)',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 2,
          },
          {
            label: 'AQI Predicho XGBoost',
            data: yPredicho,
            borderColor: '#dc2626',
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 1.5,
            borderDash: [5, 3],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y} AQI`,
            },
          },
          //Agregar para quitra los puntos
          datalabels: { display: false },
        },
        scales: {
          x: {
            ticks: {
              color: tick,
              maxRotation: 45,
              minRotation: 45,
              autoSkip: true,
              maxTicksLimit: 15,
              font: { size: 9, family: 'DM Mono, monospace' },
            },
            grid: { display: false },
          },
          y: {
            ticks: { color: tick, font: { size: 10 } },
            grid: { color: grid },
            min: 0,
          },
        },
      },
    })

    // Línea de umbral en 100
    const umbralTest = {
      id: 'umbralLineTest',
      afterDraw(chart) {
        const { ctx, chartArea, scales } = chart
        if (!chartArea) return
        const y = scales.y.getPixelForValue(100)
        ctx.save()
        ctx.beginPath()
        ctx.setLineDash([4, 4])
        ctx.strokeStyle = '#f97316'
        ctx.lineWidth = 1.5
        ctx.moveTo(chartArea.left, y)
        ctx.lineTo(chartArea.right, y)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.font = '10px DM Mono, monospace'
        ctx.fillStyle = '#f97316'
        ctx.textAlign = 'right'
        ctx.fillText('Umbral alerta (100)', chartArea.right - 6, y - 5)
        ctx.restore()
      },
    }

    Chart.register(umbralTest)
    testChartInst.current.update()

    return () => {
      if (testChartInst.current) {
        testChartInst.current.destroy()
        testChartInst.current = null
      }
      Chart.unregister(umbralTest)
    }
  }, [testData, dark])

  return (
    <div className="modelo-page">

      {/* ── Hero ── */}
      <div className="modelo-hero">
        <div className="modelo-hero-icon"><Bot size={52} /></div>
        <h1 className="modelo-title">Modelo Predictivo</h1>
        <p className="modelo-subtitle">
          Predicción de calidad del aire con XGBoost · Horizonte +1 hora
        </p>
      </div>

      {/* ── Cards superiores ── */}
      <div className="modelo-grid">

        {/* Card AQI predicho */}
        <div className="modelo-card" style={{ flex: 2 }}>
          <div className="modelo-card-icon"><BarChart2 size={28} /></div>
          <div className="modelo-card-title">Predicción AQI +1 hora</div>
          <div className="modelo-card-desc">
            Estimación basada en las últimas 12 lecturas del sensor Davis AirLink
            usando XGBoost con lags, promedios móviles y variables cíclicas.
          </div>

          {loading && (
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
              Cargando predicción…
            </div>
          )}

          {error && (
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#e84b4b', marginTop: 8 }}>
              ⚠ Error: {error}
            </div>
          )}

          {prediccion && !loading && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ background: prediccion.color, borderRadius: 16, padding: '16px 28px' }}>
                  <span style={{
                    fontSize: 52, fontWeight: 900,
                    color: prediccion.aqi_predicho <= 100 ? '#000' : '#fff',
                    fontFamily: 'DM Mono, monospace', lineHeight: 1,
                  }}>
                    {prediccion.aqi_predicho}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="hist-badge-blue" style={{ alignSelf: 'flex-start' }}>
                    Predicción para {calcularHoraPredicha(prediccion.timestamp)}
                  </span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-dark)' }}>
                    {prediccion.categoria}
                  </span>
                  <span style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', color: 'var(--text-muted)' }}>
                    Confianza: {prediccion.confianza}
                  </span>
                </div>
              </div>

              {/* Escala AQI */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: 6 }}>
                  Escala AQI
                </div>
                <div className="hist-aqi-scale">
                  {[['#34c98c',50],['#f5c842',50],['#ff7e00',50],['#ff0000',50],['#8f3f97',100]].map(([bg, flex]) => (
                    <div key={bg} style={{ flex, background: bg }} />
                  ))}
                </div>
                <div className="hist-aqi-scale-labels">
                  {['0','50','100','150','200','300+'].map(l => <span key={l}>{l}</span>)}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 11, fontFamily: 'DM Mono, monospace', color: 'var(--text-muted)' }}>
                  Lectura base: {formatTimestamp(prediccion.timestamp)} · Act: {updated}
                </span>
                <button
                  onClick={fetchPrediccion}
                  style={{
                    background: 'var(--blue)', border: 'none', borderRadius: 10,
                    color: '#fff', fontSize: 12, fontWeight: 700,
                    padding: '7px 18px', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                  }}
                >
                  Actualizar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Card info modelo */}
        <div className="modelo-card" style={{ flex: 1 }}>
          <div className="modelo-card-icon"><Brain size={28} /></div>
          <div className="modelo-card-title">Sobre el modelo</div>
          <div className="modelo-card-desc">XGBoost entrenado con datos del sensor Davis AirLink.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            {[
              [<Radio size={16} />, 'Lags temporales',    'Pasos 1, 2, 3, 6 y 12'],
              [<TrendingUp size={16} />, 'Promedios móviles',  'Ventanas 3, 6 y 12'],
              [<RefreshCw size={16} />, 'Variables cíclicas', 'Hora, día, mes'],
              [<Thermometer size={16} />, 'Sensores físicos',   'PM1, PM2.5, PM10, Temp, Hum'],
            ].map(([icon, title, desc]) => (
              <div key={title} style={{
                display: 'flex', gap: 10, padding: '10px 12px',
                background: 'var(--blue-light)', borderRadius: 10, alignItems: 'flex-start',
              }}>
                <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dark)' }}>{title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            {[
              { label: 'MAE',   value: '4.58 pts' },
              { label: 'R²',    value: '0.835'    },
              { label: 'Error', value: '2.2%'     },
              { label: 'RMSE', value: '7.72 pts'  },
          
            ].map(({ label, value }) => (
              <div key={label} style={{
                flex: 1, background: 'var(--card-bg)',
                border: '1px solid var(--border)', borderRadius: 10,
                padding: '8px 10px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-dark)', fontFamily: 'DM Mono, monospace' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Gráfica Real vs Predicho — conjunto de test ── */}
      <div className="hist-chart-card">
        <div style={{ marginBottom: 4 }}>
          <div className="hist-chart-title">Evaluación del modelo — Conjunto de test</div>
          <div className="hist-chart-sub">
            AQI real vs predicho sobre el 20% de datos reservados para validación · {testData.length.toLocaleString()} registros
          </div>
        </div>

        <div className="hist-legend">
          <div className="hist-legend-item">
            <div className="hist-legend-dot" style={{ background: '#2563eb' }} />
            AQI Real
          </div>
          <div className="hist-legend-item">
            <div className="hist-legend-dot" style={{ background: '#dc2626', width: 20, height: 2, borderRadius: 0 }} />
            AQI Predicho XGBoost
          </div>
          <div className="hist-legend-item">
            <div className="hist-legend-dot" style={{ background: '#f97316' }} />
            Umbral alerta (100)
          </div>
        </div>

        {testData.length === 0 && (
          <div className="hist-state">Cargando datos del modelo…</div>
        )}

        {testData.length > 0 && (
          <div style={{ position: 'relative', height: 280 }}>
            <canvas ref={testChartRef} />
          </div>
        )}
      </div>

      {/* ── Info footer ── */}
      <div className="modelo-info">
        <span className="modelo-info-icon"><Info size={16} /></span>
        <span>
          El modelo se actualiza cada 5 minutos con las lecturas más recientes.
          MAE: 9.23 pts AQI · Error relativo: 8.7% · Sensor Davis AirLink.
        </span>
      </div>

    </div>
  )
}
