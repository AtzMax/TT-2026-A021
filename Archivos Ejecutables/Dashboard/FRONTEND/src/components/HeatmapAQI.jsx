import { useState, useEffect, useRef, Fragment } from 'react'

const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function fmtLabel(key, group) {
  if (group === 'month') {
    const [y, m] = key.split('-')
    return `${MONTHS[+m - 1]} '${y.slice(2)}`
  }
  const [, m, d] = key.split('-')
  return `${d} ${MONTHS[+m - 1]}`
}

function cellBg(v, dark) {
  if (v == null) return dark ? '#111622' : '#e8ecf2'
  if (v <= 50)   return 'rgba(52,201,140,0.78)'
  if (v <= 75)   return 'rgba(245,200,66,0.82)'
  if (v <= 100)  return 'rgba(240,124,58,0.87)'
  if (v <= 150)  return 'rgba(232,75,75,0.87)'
  return 'rgba(120,20,20,0.95)'
}

function cellFg(v) {
  if (v == null) return 'transparent'
  if (v <= 50)   return '#04180e'
  if (v <= 75)   return '#1a1200'
  if (v <= 100)  return '#1a0900'
  if (v <= 150)  return '#180404'
  return '#ffaaaa'
}

const LEGEND = [
  ['rgba(52,201,140,0.78)',  'Bueno ≤50'],
  ['rgba(245,200,66,0.82)',  'Moderado 51–75'],
  ['rgba(240,124,58,0.87)',  'Mod. alto 76–100'],
  ['rgba(232,75,75,0.87)',   'No saludable GS 101–150'],
  ['rgba(120,20,20,0.95)',   'No saludable >150'],
]

const STAT = ({ label, value, color, dark }) => (
  <div style={{
    background: dark ? '#161b25' : '#f0f4f8',
    border: `1px solid ${dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}`,
    borderRadius: 10,
    padding: '10px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  }}>
    <span style={{ fontSize: 10, color: dark ? '#7b8799' : '#718096', fontWeight: 500 }}>{label}</span>
    <span style={{ fontSize: 20, fontWeight: 600, color: color ?? (dark ? '#e8edf5' : '#2d3436'), fontFamily: 'DM Mono, monospace' }}>
      {value}
    </span>
  </div>
)

const DAY_THRESHOLD = 60

function daysBetween(from, to) {
  if (!from || !to) return 0
  return Math.round((new Date(to) - new Date(from)) / 86400000)
}

function getMonthsInRange(from, to) {
  const months = []
  let cur = new Date(from + 'T00:00:00Z')
  const end = new Date(to + 'T00:00:00Z')
  while (cur <= end) {
    const y = cur.getUTCFullYear()
    const m = cur.getUTCMonth()
    const mf = `${y}-${String(m + 1).padStart(2, '0')}-01`
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    const mt = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    months.push({ from: mf, to: mt })
    cur = new Date(Date.UTC(y, m + 1, 1))
  }
  return months
}

function mergeHeatmaps(base, incoming) {
  if (!base || base.labels.length === 0) {
    return {
      labels: [...incoming.labels],
      matrix: incoming.matrix.map(row => [...row]),
      total: incoming.total,
      summary: {
        avg: incoming.summary.avg,
        min: incoming.summary.min,
        max: incoming.summary.max,
        _sum: incoming.summary.avg * incoming.total,
        _min: incoming.summary.min,
        _max: incoming.summary.max,
      },
    }
  }
  const baseLblIdx = {}
  base.labels.forEach((l, i) => { baseLblIdx[l] = i })
  const inLblIdx = {}
  incoming.labels.forEach((l, i) => { inLblIdx[l] = i })
  const allLabels = [...new Set([...base.labels, ...incoming.labels])].sort()
  const newMatrix = Array.from({ length: 24 }, (_, h) =>
    allLabels.map(lbl => {
      if (baseLblIdx[lbl] !== undefined) return base.matrix[h][baseLblIdx[lbl]]
      if (inLblIdx[lbl] !== undefined) return incoming.matrix[h][inLblIdx[lbl]]
      return null
    })
  )
  const newTotal = base.total + incoming.total
  const newSum = (base.summary._sum ?? 0) + incoming.summary.avg * incoming.total
  const newMin = Math.min(base.summary._min ?? Infinity, incoming.summary.min)
  const newMax = Math.max(base.summary._max ?? -Infinity, incoming.summary.max)
  return {
    labels: allLabels,
    matrix: newMatrix,
    total: newTotal,
    summary: {
      avg: newTotal > 0 ? +(newSum / newTotal).toFixed(1) : 0,
      min: +newMin.toFixed(1),
      max: +newMax.toFixed(1),
      _sum: newSum,
      _min: newMin,
      _max: newMax,
    },
  }
}

export default function HeatmapAQI({ from, to, theme }) {
  const dark = theme === 'dark'
  const noFilter = !from || !to
  const isLarge = noFilter || daysBetween(from, to) > DAY_THRESHOLD
  const [group, setGroup] = useState(() => isLarge ? 'month' : 'day')
  const [data,  setData]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [progress, setProgress] = useState(null) // { done, total }
  const abortRef = useRef(null)

  useEffect(() => {
    if (isLarge && group === 'day') setGroup('month')
  }, [isLarge])

  useEffect(() => {

    if (abortRef.current) abortRef.current.abort()
    const abort = new AbortController()
    abortRef.current = abort

    setLoading(true)
    setError(null)
    setData(null)
    setProgress(null)

    if (group === 'month' && isLarge && !noFilter) {
      const months = getMonthsInRange(from, to)
      setProgress({ done: 0, total: months.length })
      const accumulated = { current: null }
      let done = 0

      const fetchMonth = ({ from: mf, to: mt }) =>
        fetch(`/api/davis?type=heatmap&from=${mf}&to=${mt}&group=month`, { signal: abort.signal })
          .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
          .then(d => {
            accumulated.current = mergeHeatmaps(accumulated.current, d)
            done++
            setData({ ...accumulated.current })
            setProgress({ done, total: months.length })
            if (done === 1) setLoading(false)
          })

      Promise.all(months.map(fetchMonth))
        .catch(e => {
          if (e.name !== 'AbortError') { setError(e.message); setLoading(false) }
        })
    } else {
      const params = new URLSearchParams({ type: 'heatmap', group })
      if (from) params.set('from', from)
      if (to)   params.set('to', to)
      fetch(`/api/davis?${params}`, { signal: abort.signal })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
        .then(d => { setData(d); setLoading(false) })
        .catch(e => {
          if (e.name !== 'AbortError') { setError(e.message); setLoading(false) }
        })
    }

    return () => abort.abort()
  }, [from, to, group])

  const cellW = group === 'day' ? 34 : 56
  const HOUR_COL = 42

  const mutedColor   = dark ? '#7b8799' : '#718096'
  const subColor     = dark ? '#4a5568' : '#b2bec3'
  const wrapBg       = dark ? '#0e1117' : 'var(--hist-wrap-bg)'
  const toggleBg     = dark ? '#1e2535' : '#e2e8f0'

  return (
    <div>
      {/* ── Group toggle ── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 2, background: toggleBg, borderRadius: 10, padding: 3 }}>
          {[['day', 'Por día'], ['month', 'Por mes']].map(([g, label]) => {
            const disabled = g === 'day' && isLarge
            return (
              <button
                key={g}
                onClick={() => !disabled && setGroup(g)}
                title={disabled ? `Rangos mayores a ${DAY_THRESHOLD} días solo muestran vista mensual` : undefined}
                style={{
                  background: group === g ? '#2d62ed' : 'transparent',
                  border: 'none',
                  borderRadius: 8,
                  color: disabled ? (dark ? '#3a4455' : '#c5cdd9') : group === g ? '#fff' : mutedColor,
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '6px 14px',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  transition: 'background 0.2s, color 0.2s',
                  fontFamily: 'DM Sans, sans-serif',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>

        {isLarge && !progress && (
          <span style={{ fontSize: 11, color: subColor, fontFamily: 'DM Mono, monospace' }}>
            Rango &gt;{DAY_THRESHOLD} días — vista mensual automática
          </span>
        )}

        {progress && progress.done < progress.total && (
          <span style={{ fontSize: 11, color: subColor, fontFamily: 'DM Mono, monospace', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              display: 'inline-block',
              width: 80,
              height: 4,
              borderRadius: 2,
              background: dark ? '#1e2535' : '#e2e8f0',
              overflow: 'hidden',
            }}>
              <span style={{
                display: 'block',
                height: '100%',
                width: `${(progress.done / progress.total) * 100}%`,
                background: '#2d62ed',
                borderRadius: 2,
                transition: 'width 0.3s',
              }} />
            </span>
            {progress.done}/{progress.total} meses
          </span>
        )}

        {data && !loading && progress?.done === progress?.total && (
          <span style={{ fontSize: 11, color: subColor, fontFamily: 'DM Mono, monospace' }}>
            {data.labels.length} {group === 'day' ? 'días' : 'meses'} · {data.total.toLocaleString()} registros
          </span>
        )}

        {data && !loading && !progress && (
          <span style={{ fontSize: 11, color: subColor, fontFamily: 'DM Mono, monospace' }}>
            {data.labels.length} {group === 'day' ? 'días' : 'meses'} · {data.total.toLocaleString()} registros
          </span>
        )}
      </div>

      {/* ── Summary stats ── */}
      {data && !loading && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
          <STAT dark={dark} label="AQI promedio" value={data.summary.avg} color={
            data.summary.avg <= 50 ? '#34c98c' : data.summary.avg <= 100 ? '#f5c842' : '#f07c3a'
          } />
          <STAT dark={dark} label="AQI mínimo" value={data.summary.min} color="#34c98c" />
          <STAT dark={dark} label="AQI máximo" value={data.summary.max} color="#e84b4b" />
        </div>
      )}

      {error && (
        <div style={{ color: '#e84b4b', fontSize: 12, fontFamily: 'DM Mono, monospace', padding: '20px 0' }}>
          Error al cargar: {error}
        </div>
      )}

      {loading && (
        <div>
          <style>{`
            @keyframes hm-pulse {
              0%,100% { opacity: 0.35 }
              50%      { opacity: 0.7  }
            }
          `}</style>
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            {[80, 60, 60].map((w, i) => (
              <div key={i} style={{
                width: w, height: 52, borderRadius: 10,
                background: dark ? '#1e2535' : '#e2e8f0',
                animation: `hm-pulse 1.4s ease-in-out ${i * 0.15}s infinite`,
              }} />
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '42px repeat(14, 34px)', gap: 2 }}>
            <div />
            {Array.from({ length: 14 }, (_, i) => (
              <div key={i} style={{
                height: 12, borderRadius: 3,
                background: dark ? '#1e2535' : '#e2e8f0',
                animation: `hm-pulse 1.4s ease-in-out ${i * 0.05}s infinite`,
              }} />
            ))}
            {Array.from({ length: 24 }, (_, h) => (
              <Fragment key={h}>
                <div style={{
                  height: 24, borderRadius: 3,
                  background: dark ? '#1a2030' : '#edf2f7',
                  animation: `hm-pulse 1.4s ease-in-out ${h * 0.03}s infinite`,
                }} />
                {Array.from({ length: 14 }, (_, ci) => (
                  <div key={ci} style={{
                    height: 24, borderRadius: 3,
                    background: dark ? '#1e2535' : '#e2e8f0',
                    animation: `hm-pulse 1.4s ease-in-out ${(h * 14 + ci) * 0.01}s infinite`,
                  }} />
                ))}
              </Fragment>
            ))}
          </div>
          <div style={{ color: subColor, fontSize: 11, fontFamily: 'DM Mono, monospace', marginTop: 12, textAlign: 'center' }}>
            Cargando mapa de calor…
          </div>
        </div>
      )}

      {data && !loading && data.labels.length === 0 && (
        <div style={{ color: subColor, fontSize: 12, fontFamily: 'DM Mono, monospace', padding: '30px 0', textAlign: 'center' }}>
          Sin datos para el período seleccionado.
        </div>
      )}

      {data && !loading && data.labels.length > 0 && (
        <div style={{ overflowX: 'auto', overflowY: 'visible', paddingBottom: 8 }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: `${HOUR_COL}px repeat(${data.labels.length}, ${cellW}px)`,
            gap: 2,
            minWidth: HOUR_COL + data.labels.length * (cellW + 2),
          }}>
            <div />
            {data.labels.map((lbl, i) => (
              <div
                key={i}
                style={{
                  fontSize: 9,
                  color: mutedColor,
                  textAlign: 'center',
                  fontFamily: 'DM Mono, monospace',
                  paddingBottom: 4,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  lineHeight: 1.3,
                }}
              >
                {fmtLabel(lbl, group)}
              </div>
            ))}

            {Array.from({ length: 24 }, (_, h) => (
              <Fragment key={h}>
                <div
                  style={{
                    fontSize: 10,
                    color: subColor,
                    fontFamily: 'DM Mono, monospace',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    paddingRight: 6,
                    position: 'sticky',
                    left: 0,
                    background: wrapBg,
                    zIndex: 2,
                    height: 24,
                  }}
                >
                  {h}h
                </div>
                {data.matrix[h].map((v, ci) => (
                  <div
                    key={ci}
                    title={v !== null
                      ? `${fmtLabel(data.labels[ci], group)} ${h}:00 — AQI ${v}`
                      : `${fmtLabel(data.labels[ci], group)} ${h}:00 — sin datos`}
                    style={{
                      height: 24,
                      background: cellBg(v, dark),
                      color: cellFg(v),
                      borderRadius: 3,
                      fontSize: 8,
                      fontWeight: 600,
                      fontFamily: 'DM Mono, monospace',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'default',
                      transition: 'opacity 0.15s, transform 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.transform = 'scale(1.06)' }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '1';   e.currentTarget.style.transform = 'scale(1)' }}
                  >
                    {v !== null ? v : ''}
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
      )}
 
      {data && !loading && (
        <div style={{ display: 'flex', gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
          {LEGEND.map(([color, label]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: mutedColor }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
              {label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
