import { useState, useEffect, useCallback } from 'react'

const POLL_MS = 2000

export function useCameraStatus() {
  const [cameraOnline, setCameraOnline] = useState(false)
  const [detecciones, setDetecciones] = useState({
    personas: 0,
    cigarro: false,
    detecciones_ultimas: 0
  })
  const [loading, setLoading] = useState(true)

  const fetchCameraData = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:5000/status', {
        signal: AbortSignal.timeout(3000)
      })
      if (response.ok) {
        const data = await response.json()
        setCameraOnline(true)
        setDetecciones({
          personas: data.personas || 0,
          cigarro: data.hay_cigarro || false,
          detecciones_ultimas: data.detecciones_ultimas || 0
        })
      } else {
        setCameraOnline(false)
      }
    } catch (err) {
      // Silenciar errores de conexión
      setCameraOnline(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCameraData()
    const interval = setInterval(fetchCameraData, POLL_MS)
    return () => clearInterval(interval)
  }, [fetchCameraData])

  return { cameraOnline, detecciones, loading }
}
