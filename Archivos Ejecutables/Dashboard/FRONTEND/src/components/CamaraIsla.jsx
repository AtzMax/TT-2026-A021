import { useEffect, useState } from 'react'
import { Video, Camera, Bot, Radio, BarChart2, AlertCircle } from 'lucide-react'

export default function CamaraIslaDashboard() {
  const [metadatos, setMetadatos] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cameraOnline, setCameraOnline] = useState(false)
  const [videoError, setVideoError] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const metaRes = await fetch('http://localhost:5000/status', {
          signal: AbortSignal.timeout(3000) // Timeout de 3 segundos
        })
        if (metaRes.ok) {
          const metaData = await metaRes.json()
          setMetadatos(metaData)
          setCameraOnline(true)
          setVideoError(false)
        } else {
          setCameraOnline(false)
        }
      } catch (err) {
        // No loguear errores explícitamente
        setCameraOnline(false)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 2000)
    return () => clearInterval(interval)
  }, [])

  const handleVideoError = () => {
    setVideoError(true)
    setCameraOnline(false)
  }

  if (loading) return (
    <div className="cam-loading">
      <div className="cam-loading-spinner" />
      <span className="cam-loading-text">Conectando con la cámara...</span>
    </div>
  )

  return (
    <div className="cam-page">

      {/* ── Hero ── */}
      <div className="cam-hero">
        <div className="cam-hero-icon">
          <Video size={28} />
        </div>
        <div className="cam-hero-text">
          <h1 className="cam-hero-title">Cámara Isla</h1>
          <p className="cam-hero-sub">Detección YOLO · Inferencia en tiempo real</p>
        </div>
        {metadatos ? (
          <>
            <span className={`${cameraOnline ? 'cam-live-badge' : 'cam-live-badge-static'}`}>
              {cameraOnline ? 'LIVE' : 'OFFLINE'}
            </span>
          </>
        ) : (
          <>          
          </>
        )}
      </div>

      {/* ── Grid ── */}
      <div className="cam-grid">

        {/* Video en Vivo – ancho completo */}
        <div className="cam-card cam-card-full">
          <div className="cam-card-header">
            <span className="cam-card-title">Video en Vivo</span>
          </div>
          <div className="cam-feed-wrap">
            {cameraOnline && !videoError ? (
              <img
                src="http://localhost:5000/video_feed"
                alt="Video Isla"
                className="cam-stream"
                onError={handleVideoError}
              />
            ) : (
              <div className="cam-no-video">
                <AlertCircle size={64} className="cam-no-video-icon" />
                <p className="cam-no-video-text">Video no disponible</p>
                <p className="cam-no-video-hint">Verificar el estado de la cámara</p>
              </div>
            )}
          </div>
        </div>

        {/* Estado del Sistema */}
        <div className="cam-card">
          <div className="cam-card-header">
            <span className="cam-card-title">Estado del Sistema</span>
          </div>
          <div className="cam-meta-list">
            {metadatos ? (
              <>
                <div className="cam-meta-row">
                  <span className="cam-meta-label">Cámara</span>
                  <span className={`cam-status-badge ${cameraOnline ? 'cam-status-online' : 'cam-status-offline'}`}>
                    {cameraOnline ? 'ONLINE' : 'OFFLINE'}
                  </span>
                </div>

                {cameraOnline && (
                  <>
                    <div className="cam-meta-row">
                      <span className="cam-meta-label">Backend</span>
                      <span className={`cam-status-badge ${metadatos.backend === 'online' ? 'cam-status-online' : 'cam-status-offline'}`}>
                        {metadatos.backend || 'Desconectado'}
                      </span>
                    </div>

                    <div className="cam-meta-row">
                      <span className="cam-meta-label">Personas detectadas</span>
                      <strong className="cam-meta-value">{metadatos.personas || 0}</strong>
                    </div>

                    <div className="cam-meta-row">
                      <span className="cam-meta-label">Cigarro detectado</span>
                      <span className={`cam-status-badge ${metadatos.hay_cigarro ? 'cam-status-offline' : 'cam-status-online'}`}>
                        {metadatos.hay_cigarro ? 'SÍ' : 'NO'}
                      </span>
                    </div>

                    <div className="cam-meta-row">
                      <span className="cam-meta-label">Total detecciones</span>
                      <strong className="cam-meta-value">{metadatos.detecciones_ultimas || 0}</strong>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="cam-meta-row">
                <span className="cam-meta-label">Cámara</span>
                <span className="cam-status-badge cam-status-offline">OFFLINE</span>
              </div>
            )}
          </div>
        </div>

        {/* Detecciones Recientes */}
        {cameraOnline && (
          <div className="cam-card">
            <div className="cam-card-header">
              <span className="cam-card-title">Detecciones Recientes</span>
            </div>
            <div className="cam-detections-body">
              {metadatos?.detecciones_ultimas > 0 ? (
                <div className="cam-detections-found">
                  <span className="cam-detections-count">{metadatos.detecciones_ultimas}</span>
                  <span className="cam-detections-label">objeto(s) detectado(s)</span>
                </div>
              ) : (
                <p className="cam-empty">Sin detecciones en este momento</p>
              )}
            </div>
          </div>
        )}

        {/* Flujo de Datos */}
        {cameraOnline && (
          <div className="cam-card">
            <div className="cam-card-header">
              <span className="cam-card-title">Flujo de Datos</span>
            </div>
            <div className="cam-flow">
              <div className="cam-flow-step">
                <div className="cam-flow-icon"><Camera size={22} /></div>
                <span>Captura</span>
              </div>
              <div className="cam-flow-arrow">→</div>
              <div className="cam-flow-step">
                <div className="cam-flow-icon"><Bot size={22} /></div>
                <span>YOLO</span>
              </div>
              <div className="cam-flow-arrow">→</div>
              <div className="cam-flow-step">
                <div className="cam-flow-icon"><Radio size={22} /></div>
                <span>Backend</span>
              </div>
              <div className="cam-flow-arrow">→</div>
              <div className="cam-flow-step">
                <div className="cam-flow-icon"><BarChart2 size={22} /></div>
                <span>Dashboard</span>
              </div>
            </div>
          </div>
        )}

      </div>

    </div>
  )
}
