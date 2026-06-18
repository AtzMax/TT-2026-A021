import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchLatest, fetchHistory } from '../api/davis'
import { generateNotifications } from '../utils/aqi'

const POLL_MS = 90_000
const MAX_HISTORY = 180

const emptyData = { aqi: 0, humedad: 0, temperatura: 0, pm25: 0, pm10: 0 }
const emptyHist = { labels: [], aqi: [], pm25: [], pm10: [] }

function parseRow(row) {
  return {
    aqi: parseFloat(row.aqi) || 0,
    humedad: parseFloat(row.humedad) || 0,
    temperatura: parseFloat(row.temperatura) || 0,
    pm25: parseFloat(row.pm2_5) || 0,
    pm10: parseFloat(row.pm10) || 0,
  }
}

function toHHMM(isoStr) {
  return (isoStr.split(' ')[1] || '').slice(0, 5)
}

function addToHist(h, row) {
  const labels = [...h.labels, toHHMM(row.hora_sensor_utc)]
  const aqi = [...h.aqi, parseFloat(row.aqi) || 0]
  const pm25 = [...h.pm25, parseFloat(row.pm2_5) || 0]
  const pm10 = [...h.pm10, parseFloat(row.pm10) || 0]
  if (labels.length > MAX_HISTORY) {
    return { labels: labels.slice(1), aqi: aqi.slice(1), pm25: pm25.slice(1), pm10: pm10.slice(1) }
  }
  return { labels, aqi, pm25, pm10 }
}

export function useAirQuality() {
  const [data, setData] = useState(emptyData)
  const [history, setHistory] = useState(emptyHist)
  const [lastTs, setLastTs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [reloading, setReloading] = useState(false)
  const [error, setError] = useState(null)
  const [notifications, setNotifications] = useState([])

  const lastTsRef = useRef(null)
  const prevLevelsRef = useRef({ aqi: -1, pm25: -1, pm10: -1 })

  const addNotifs = useCallback((newData) => {
    const { notifications: n, newLevels } = generateNotifications(newData, prevLevelsRef.current)
    prevLevelsRef.current = newLevels
    if (n.length > 0) {
      setNotifications((prev) => [...n, ...prev].slice(0, 20))
    }
  }, [])

  const loadLatest = useCallback(async () => {
    try {
      const row = await fetchLatest()
      if (!row?.hora_sensor_utc) return
      const ts = row.hora_sensor_utc
      if (ts !== lastTsRef.current) {
        lastTsRef.current = ts
        const parsed = parseRow(row)
        setData(parsed)
        setLastTs(ts)
        setHistory((h) => addToHist(h, row))
        addNotifs(parsed)
      }
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [addNotifs])

  const reload = useCallback(async () => {
    setReloading(true)
    lastTsRef.current = null
    await loadLatest()
    setReloading(false)
  }, [loadLatest])

  useEffect(() => {
    ;(async () => {
      try {
        const rows = await fetchHistory()
        if (Array.isArray(rows) && rows.length > 0) {
          const h = rows.reduce(addToHist, emptyHist)
          setHistory(h)
        }
      } catch (e) {
        console.warn('history error:', e)
      }
      await loadLatest()
      setLoading(false)
    })()

    const id = setInterval(loadLatest, POLL_MS)
    return () => clearInterval(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }, [])

  const clearAll = useCallback(() => {
    setNotifications([])
  }, [])

  return { data, history, lastTs, loading, reloading, error, notifications, reload, markAllRead, clearAll }
}
