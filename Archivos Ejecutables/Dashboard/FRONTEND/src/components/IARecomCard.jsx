import { useState, useEffect, useCallback } from 'react'
import { Sparkles, RefreshCw, AlertTriangle, Clock } from 'lucide-react'
import { fetchIARecomendacion } from '../api/davis'

const POLL_MS = 15 * 60 * 1000

const RIESGO_STYLE = {
  bajo:     { bg: 'var(--rec-good-bg)',   color: '#2F855A', label: 'Riesgo Bajo' },
  moderado: { bg: 'var(--rec-mod-bg)',    color: '#B45309', label: 'Riesgo Moderado' },
  alto:     { bg: 'var(--rec-warn-bg)',   color: '#E65100', label: 'Riesgo Alto' },
  muy_alto: { bg: 'var(--rec-danger-bg)', color: '#C53030', label: 'Riesgo Muy Alto' },
}

function tiempoDesde(isoStr) {
  if (!isoStr) return ''
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
  if (diff < 60) return 'hace un momento'
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`
  return `hace ${Math.floor(diff / 3600)} h`
}

export default function IARecomCard() {
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (force = false) => {
    try {
      if (force) setRefreshing(true)
      else if (!data) setLoading(true)
      setError(null)
      const result = await fetchIARecomendacion(force)
      setData(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [data])

  useEffect(() => {
    load()
    const id = setInterval(() => load(), POLL_MS)
    return () => clearInterval(id)
  }, [])

  const style = RIESGO_STYLE[data?.nivel_riesgo] ?? RIESGO_STYLE.moderado

  return (
    <>
      <style>{`
        @keyframes ia-spin { to { transform: rotate(360deg); } }
        .ia-spin { animation: ia-spin 1s linear infinite; }
        @keyframes ia-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        .ia-pulse { animation: ia-pulse 1.8s ease-in-out infinite; }
      `}</style>

      <div
        className="rec-card"
        style={{ background: data ? style.bg : 'var(--rec-good-bg)', borderColor: data ? `${style.color}33` : 'var(--border)' }}
      >
        {/* ── Cabecera ─────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={15} style={{ color: data ? style.color : 'var(--text-muted)' }} />
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.5px',
              textTransform: 'uppercase', fontFamily: 'DM Mono, monospace',
              color: data ? style.color : 'var(--text-muted)',
            }}>
              {'Recomendación'}
            </span>
            {data?.fromCache && (
              <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>
                
              </span>
            )}
          </div>

          <button
            onClick={() => load(true)}
            disabled={refreshing || loading}
            title="Actualizar recomendación IA"
            style={{
              background: 'none', border: 'none', cursor: refreshing ? 'default' : 'pointer',
              color: data ? style.color : 'var(--text-muted)',
              padding: 2, display: 'flex', alignItems: 'center',
              opacity: refreshing || loading ? 0.5 : 1,
            }}
          >
            <RefreshCw size={13} className={refreshing ? 'ia-spin' : ''} />
          </button>
        </div>

        {/* ── Cargando ─────────────────────────────────────────── */}
        {loading && !data && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '10px 0', fontFamily: 'DM Mono, monospace' }}>
            <span className="ia-pulse">Generando recomendación…</span>
          </div>
        )}

        {/* ── Error sin datos previos ───────────────────────────── */}
        {error && !data && (
          <div style={{ fontSize: 12, padding: '4px 0' }}>
            <div style={{ fontWeight: 600, color: '#C53030', marginBottom: 2 }}>No se pudo consultar la IA</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.4 }}>{error}</div>
            <button
              onClick={() => load(true)}
              style={{
                marginTop: 8, fontSize: 11, padding: '4px 10px', borderRadius: 6,
                background: 'transparent', border: '1px solid var(--border)',
                cursor: 'pointer', color: 'var(--text-dark)',
              }}
            >
              Reintentar
            </button>
          </div>
        )}

        {/* ── Contenido principal ──────────────────────────────── */}
        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

            {/* Nivel + resumen */}
            <div>
              <div className="rec-label" style={{ color: style.color }}>
                {data.emoji_estado} {style.label}
              </div>
              <div className="rec-text">{data.resumen}</div>
            </div>

            {/* Recomendaciones generales */}
            {data.recomendaciones_generales?.length > 0 && (
              <div>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4,
                  fontFamily: 'DM Mono, monospace',
                }}>
                  Recomendaciones
                </div>
                <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {data.recomendaciones_generales.map((rec, i) => (
                    <li key={i} style={{ fontSize: 12, color: 'var(--text-dark)', lineHeight: 1.45 }}>{rec}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Grupos sensibles */}
            {data.recomendaciones_grupos_sensibles?.length > 0 && (
              <div style={{
                padding: '6px 10px', borderRadius: 8,
                background: `${style.color}10`, border: `1px solid ${style.color}22`,
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: style.color,
                  textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3,
                  fontFamily: 'DM Mono, monospace',
                }}>
                  Grupos sensibles
                </div>
                {data.recomendaciones_grupos_sensibles.map((rec, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-dark)', lineHeight: 1.45 }}>{rec}</div>
                ))}
              </div>
            )}

            {/* Acciones inmediatas (solo nivel alto / muy_alto) */}
            {data.acciones_inmediatas?.length > 0 && (
              <div style={{
                padding: '6px 10px', borderRadius: 8,
                background: '#C5303015', border: '1px solid #C5303033',
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: '#C53030',
                  textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3,
                  fontFamily: 'DM Mono, monospace',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <AlertTriangle size={11} /> Acciones inmediatas
                </div>
                {data.acciones_inmediatas.map((acc, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#C53030', lineHeight: 1.45, fontWeight: 500 }}>{acc}</div>
                ))}
              </div>
            )}

            {/* Contexto universitario */}
            {data.mensaje_contexto && (
              <div className="rec-contexto">{data.mensaje_contexto}</div>
            )}

            {/* Pie: timestamp + caché expirado */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <Clock size={9} style={{ color: 'var(--text-muted)' }} />
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>
                {data.cacheExpired ? 'Caché expirada — ' : ''}Actualizado {tiempoDesde(data.generatedAt)}
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
 