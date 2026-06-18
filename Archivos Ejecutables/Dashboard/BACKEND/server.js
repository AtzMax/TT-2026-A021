import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'

const app = express()
const PORT = process.env.PORT || 3001

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent'
const GEMINI_AQI_DELTA = 10              // puntos de AQI para considerar cambio significativo
// Cache basado en datos de Supabase — se ignora contexto escolar (siempre cambia)
let geminiCache = { data: null, lastDataTimestamp: null, lastAqi: null, lastBand: null }

const heatmapCache = new Map()
const HEATMAP_CACHE_TTL = 5 * 60 * 1000 // 5 minutos

const __dirname = dirname(fileURLToPath(import.meta.url))
const PREDICT_SCRIPT = join(__dirname, 'predict_model.py')

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: Faltan SUPABASE_URL o SUPABASE_KEY en .env')
  process.exit(1)
}

app.use(cors())
app.use(express.json())
app.use(express.raw({ type: 'video/*', limit: '100mb' }))
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  next()
})

async function supabaseFetch(path, timeoutMs = 30000) {
  const res = await fetch(path, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`Supabase ${res.status}`)
  return res.json()
}

async function supabaseCount(path) {
  const res = await fetch(path + '&limit=1', {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: 'application/json',
      Prefer: 'count=exact',
    },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`Supabase count ${res.status}`)
  const range = res.headers.get('content-range') // e.g. "0-0/42318"
  return parseInt(range?.split('/')[1] ?? '0', 10)
}

async function fetchInChunks(urls, concurrency = 4) {
  const results = []
  for (let i = 0; i < urls.length; i += concurrency) {
    const chunk = urls.slice(i, i + concurrency)
    const settled = await Promise.allSettled(chunk.map(url => supabaseFetch(url)))
    for (const s of settled) {
      results.push(s.status === 'fulfilled' ? s.value : [])
    }
  }
  return results
}

function runPythonPrediction(features) {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === 'win32' ? 'py' : 'python'
    const proc = spawn(pythonCmd, [PREDICT_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    proc.on('error', (err) => {
      reject(new Error(`Error al ejecutar Python: ${err.message}`))
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Python exited ${code}: ${stderr}`))
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (err) {
        reject(new Error(`JSON parse failed: ${err.message}\n${stdout}`))
      }
    })

    proc.stdin.write(JSON.stringify(features))
    proc.stdin.end()
  })
}

function floorTo15(date) {
  const minutes = date.getUTCMinutes()
  const floored = Math.floor(minutes / 15) * 15
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    floored,
    0,
    0,
  ))
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min)
} 

app.get('/api/modelo/simulacion', async (req, res) => {
  try {
    const now = new Date()
    const blocks = []
    for (let i = 4; i >= 0; i -= 1) {
      const date = new Date(now.getTime() - i * 15 * 60 * 1000)
      blocks.push({
        date,
        pm25: randomBetween(25, 70),
        pm10: randomBetween(40, 80),
        temp: randomBetween(24, 31),
        hum: randomBetween(30, 55),
        aqi: randomBetween(60, 110),
        pm1: randomBetween(15, 45),
      })
    }

    const current = blocks[4]
    const h1 = blocks[3]
    const h2 = blocks[2]
    const h3 = blocks[1]
    const actualNext = {
      date: new Date(now.getTime() + 15 * 60 * 1000),
      pm25: +Math.max(0, Math.min(250, current.pm25 + randomBetween(-5, 12))).toFixed(2),
      pm10: +Math.max(0, Math.min(300, current.pm10 + randomBetween(-10, 15))).toFixed(2),
      temp: +Math.max(0, Math.min(40, current.temp + randomBetween(-1.5, 1.5))).toFixed(2),
      hum: +Math.max(0, Math.min(100, current.hum + randomBetween(-4, 4))).toFixed(2),
      aqi: +Math.max(0, Math.min(200, current.aqi + randomBetween(-10, 12))).toFixed(2),
      pm1: +Math.max(0, Math.min(80, current.pm1 + randomBetween(-4, 8))).toFixed(2),
    }

    const recentBlocks = [h1, h2, h3, current].map((block) => ({
      date: block.date.toISOString(),
      pm25: +block.pm25.toFixed(2),
      pm10: +block.pm10.toFixed(2),
    }))

    const features = {
      temp: current.temp,
      hum: current.hum,
      pm10: current.pm10,
      aqi: current.aqi,
      pm1: current.pm1,
      pm25_lag_1: current.pm25,
      pm10_lag_1: current.pm10,
      pm25_lag_2: h1.pm25,
      pm10_lag_2: h1.pm10,
      pm25_lag_3: h2.pm25,
      pm10_lag_3: h2.pm10,
      diff_pm25: current.pm25 - h1.pm25,
      rolling_mean_pm25: average([current.pm25, h1.pm25, h2.pm25, h3.pm25]),
      rolling_std_pm25: Math.sqrt(
        average([
          current.pm25,
          h1.pm25,
          h2.pm25,
          h3.pm25,
        ].map((value) => Math.pow(value - average([current.pm25, h1.pm25, h2.pm25, h3.pm25]), 2))),
      ),
      hour: current.date.getUTCHours(),
      day_of_week: current.date.getUTCDay(),
      time_gap: 15.0,
    }

    const pythonResult = await runPythonPrediction(features)
    const prediction = +pythonResult.prediction.toFixed(2)
    const actualValue = actualNext.pm25
    const delta = +((actualValue - prediction).toFixed(2))

    const response = {
      simulation: true,
      simulatedAt: now.toISOString(),
      modelName: pythonResult.modelName,
      prediction,
      threshold: pythonResult.threshold,
      features,
      recentBlocks,
      actualNext,
    }

    if (req.query.validate === 'true') {
      response.delta = delta
      response.canRelease = actualValue <= prediction
      response.recommendation = actualValue <= prediction
        ? 'La simulación indica que el valor real de referencia queda por debajo de la predicción; por ahora puedes relajar la alerta.'
        : 'La simulación indica que el valor real de referencia supera la predicción; mantén la alerta activa.'
    }

    return res.json(response)
  } catch (err) {
    console.error('Simulación error:', err.message)
    res.status(500).json({ error: err.message })
  }
})


app.get('/api/modelo/validacion', async (req, res) => {
  try {
    const url =
      `${SUPABASE_URL}/rest/v1/lecturas_davis` +
      `?select=hora_sensor_utc,pm2_5,pm10,temperatura,humedad,aqi,pm1` +
      `&order=hora_sensor_utc.desc&limit=60`

    const rows = await supabaseFetch(url)
    if (!rows?.length) {
      return res.status(404).json({ error: 'No se encontraron datos de Davis para validación' })
    }

    const bucketsMap = new Map()
    for (const row of rows) {
      const dt = new Date(row.hora_sensor_utc.replace(' ', 'T') + 'Z')
      if (Number.isNaN(dt.getTime())) continue

      const key = floorTo15(dt).toISOString()
      const bucket = bucketsMap.get(key) ?? {
        date: new Date(key),
        pm25: [],
        pm10: [],
        temp: [],
        hum: [],
        aqi: [],
        pm1: [],
      }

      bucket.pm25.push(parseFloat(row.pm2_5) || 0)
      bucket.pm10.push(parseFloat(row.pm10) || 0)
      bucket.temp.push(parseFloat(row.temperatura) || 0)
      bucket.hum.push(parseFloat(row.humedad) || 0)
      bucket.aqi.push(parseFloat(row.aqi) || 0)
      bucket.pm1.push(parseFloat(row.pm1) || 0)
      bucketsMap.set(key, bucket)
    }

    const buckets = Array.from(bucketsMap.values()).sort((a, b) => b.date - a.date)
    if (buckets.length < 5) {
      return res.status(400).json({ error: 'Se requieren al menos 5 bloques de 15 minutos para validar la predicción con el siguiente valor real' })
    }

    const [actualNext, current, h1, h2, h3] = buckets
    const recentBlocks = [actualNext, current, h1, h2, h3].map((block) => ({
      date: block.date.toISOString(),
      pm25: +average(block.pm25).toFixed(2),
      pm10: +average(block.pm10).toFixed(2),
    }))

    const currentPm25 = average(current.pm25)
    const h1Pm25 = average(h1.pm25)
    const h2Pm25 = average(h2.pm25)
    const h3Pm25 = average(h3.pm25)

    const features = {
      temp: average(current.temp),
      hum: average(current.hum),
      pm10: average(current.pm10),
      aqi: average(current.aqi),
      pm1: average(current.pm1),
      pm25_lag_1: currentPm25,
      pm10_lag_1: average(current.pm10),
      pm25_lag_2: h1Pm25,
      pm10_lag_2: average(h1.pm10),
      pm25_lag_3: h2Pm25,
      pm10_lag_3: average(h2.pm10),
      diff_pm25: currentPm25 - h1Pm25,
      rolling_mean_pm25: average([currentPm25, h1Pm25, h2Pm25, h3Pm25]),
      rolling_std_pm25: Math.sqrt(
        average([currentPm25, h1Pm25, h2Pm25, h3Pm25].map((value) => Math.pow(value - average([currentPm25, h1Pm25, h2Pm25, h3Pm25]), 2)))
      ),
      hour: current.date.getUTCHours(),
      day_of_week: current.date.getUTCDay(),
      time_gap: 15.0,
    }

    const pythonResult = await runPythonPrediction(features)
    const prediction = +pythonResult.prediction.toFixed(2)
    const actualValue = +average(actualNext.pm25).toFixed(2)
    const delta = +((actualValue - prediction).toFixed(2))
    const absDelta = Math.abs(delta)
    const isBelowThreshold = actualValue <= pythonResult.threshold

    const recommendation = isBelowThreshold
      ? 'El valor real quedó por debajo del umbral del modelo; puedes relajar la alerta parcialmente.'
      : actualValue <= prediction
        ? 'El valor real quedó por debajo de la predicción, pero sigue cerca del umbral. Mantén vigilancia moderada.'
        : 'El valor real superó la predicción. Conserva la alerta activa y revisa posibles incrementos.'

    return res.json({
      modelName: pythonResult.modelName,
      prediction,
      threshold: pythonResult.threshold,
      features,
      recentBlocks,
      actualNext: {
        date: actualNext.date.toISOString(),
        pm25: actualValue,
        pm10: +average(actualNext.pm10).toFixed(2),
      },
      delta,
      absDelta,
      canRelease: actualValue <= prediction,
      recommendation,
    })
  } catch (err) {
    console.error('Validación error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/video/stream', async (req, res) => {
  try {
    const metadata = req.headers['x-video-metadata']
    const videoData = req.body

    if (!videoData || videoData.length === 0) {
      return res.status(400).json({ error: 'No video data received' })
    }

    const timestamp = Date.now()
    const filename = `video_${timestamp}.mp4`
    const filepath = join(__dirname, 'uploads', filename)

    try {
      writeFileSync(filepath, videoData)
    } catch (err) {
      console.warn('Could not save video file locally:', err.message)
    }

    const response = {
      status: 'received',
      timestamp,
      filename,
      videoSize: videoData.length,
      metadata: metadata ? JSON.parse(metadata) : null,
    }

    console.log(`Video stream received: ${filename} (${videoData.length} bytes)`)
    return res.json(response)
  } catch (err) {
    console.error('Video stream error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/video/metadata', async (req, res) => {
  try {
    const { 
      source, 
      latitude, 
      longitude, 
      altitude, 
      camera, 
      resolution, 
      fps, 
      quality,
      extra 
    } = req.body

    if (!source) {
      return res.status(400).json({ error: 'source is required' })
    }

    const metadata = {
      timestamp: new Date().toISOString(),
      source,
      location: { latitude, longitude, altitude },
      camera: { name: camera, resolution, fps, quality },
      extra,
    }

    console.log('Video metadata received:', metadata)
    return res.json({ status: 'metadata received', metadata })
  } catch (err) {
    console.error('Metadata error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/video/status', async (req, res) => {
  try {
    return res.json({
      status: 'online',
      endpoints: {
        'POST /api/video/stream': 'Send video binary data with metadata in X-Video-Metadata header',
        'POST /api/video/metadata': 'Send video metadata (JSON body)',
        'GET /api/video/status': 'Check video stream service status',
      },
      examples: {
        curl_stream: 'curl -X POST http://localhost:3001/api/video/stream -H "X-Video-Metadata: {\\"source\\":\\"camera1\\"}" --data-binary @video.mp4',
        python_metadata: 'requests.post("http://localhost:3001/api/video/metadata", json={"source":"camera1", "camera":"IP Camera"})',
      },
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

const BANDAS = [
  {
    nivel: 0,
    nombre: 'Buena',
    pm25_max: 12,
    mensaje_general: 'Calidad del aire excelente. El ambiente es seguro para todas las personas.',
    mensaje_expuesto: null,
    contexto: null,
  },
  {
    nivel: 1,
    nombre: 'Moderada',
    pm25_max: 35.4,
    mensaje_general: 'Calidad del aire aceptable. Personas muy sensibles pueden experimentar molestias.',
    mensaje_expuesto: 'Personas con enfermedades respiratorias deben reducir actividades prolongadas al aire libre.',
    contexto: null,
  },
  {
    nivel: 2,
    nombre: 'Grupos sensibles',
    pm25_max: 55.4,
    mensaje_general: 'Nivel insalubre para grupos sensibles. Limiten el tiempo al aire libre.',
    mensaje_expuesto: 'Niños, adultos mayores y personas con asma deben evitar actividades físicas intensas afuera.',
    contexto: 'Considere usar mascarilla KN95 si necesita salir.',
  },
  {
    nivel: 3,
    nombre: 'Dañina',
    pm25_max: Infinity,
    mensaje_general: 'Calidad del aire crítica. Evite actividades físicas y use purificadores de aire.',
    mensaje_expuesto: 'Toda la población debe minimizar exposición al aire exterior. Use mascarilla N95.',
    contexto: 'Mantenga ventanas cerradas y use purificadores si dispone de ellos.',
  },
]

function bandaDesPm25(pm25) {
  return BANDAS.find((b) => pm25 <= b.pm25_max) ?? BANDAS[BANDAS.length - 1]
}

app.get('/api/recomendacion', async (req, res) => {
  try {
    const url =
      `${SUPABASE_URL}/rest/v1/lecturas_davis` +
      `?select=hora_sensor_utc,pm2_5,aqi&order=hora_sensor_utc.desc&limit=2`
    const rows = await supabaseFetch(url)

    if (!rows?.length) {
      return res.status(404).json({ error: 'Sin datos disponibles' })
    }

    const ultima = rows[0]
    const pm25Actual = parseFloat(ultima.pm2_5) || 0
    const banda = bandaDesPm25(pm25Actual)

    let deltaPm25 = null
    let iconoTendencia = '→'
    if (rows.length >= 2) {
      const pm25Anterior = parseFloat(rows[1].pm2_5) || 0
      deltaPm25 = +(pm25Actual - pm25Anterior).toFixed(1)
      iconoTendencia = deltaPm25 > 2 ? '↑' : deltaPm25 < -2 ? '↓' : '→'
    }

    return res.json({
      nivel_alerta: banda.nivel,
      banda_nombre: banda.nombre,
      mensaje_general: banda.mensaje_general,
      mensaje_expuesto: banda.mensaje_expuesto,
      contexto_activo: banda.contexto,
      delta_aqi: deltaPm25,
      icono_tendencia: iconoTendencia,
      pm25: pm25Actual,
      timestamp: ultima.hora_sensor_utc,
    })
  } catch (err) {
    res.status(500).json({ error: 'Error generando recomendación', detail: err.message })
  }
})

app.get('/api/davis', async (req, res) => {
  const type = req.query.type ?? 'latest'

  try {
    if (type === 'latest') {
      const url = `${SUPABASE_URL}/rest/v1/lecturas_davis?select=*&order=hora_sensor_utc.desc&limit=1`
      const rows = await supabaseFetch(url)
      return res.json(rows?.length ? rows[0] : null)
    }

    if (type === 'history') {
      const url =
        `${SUPABASE_URL}/rest/v1/lecturas_davis` +
        `?select=hora_sensor_utc,aqi,pm2_5,pm10` +
        `&order=hora_sensor_utc.desc` +
        `&limit=36`
      const rows = await supabaseFetch(url)
      const sorted = (rows ?? []).reverse()
      return res.json(sorted)
    }
if (type === 'historico') {
      const fromDate = req.query.from
      const toDate   = req.query.to

      const batchSize = 1000

      let baseParams = `?select=hora_sensor_utc,aqi,pm1,pm2_5,pm10,temperatura,humedad&order=hora_sensor_utc.asc`
      if (fromDate) baseParams += `&hora_sensor_utc=gte.${encodeURIComponent(fromDate + ' 00:00:00')}`
      if (toDate)   baseParams += `&hora_sensor_utc=lte.${encodeURIComponent(toDate + ' 23:59:59')}`

      const baseUrl = `${SUPABASE_URL}/rest/v1/lecturas_davis${baseParams}`
      const totalCount = await supabaseCount(baseUrl)

      const offsets = []
      for (let o = 0; o < Math.max(totalCount, 1); o += batchSize) offsets.push(o)

      const urls = offsets.map(offset => `${baseUrl}&limit=${batchSize}&offset=${offset}`)
      const batches = await fetchInChunks(urls)

      const seen = new Set()
      const allRows = []
      for (const batch of batches) {
        if (!batch?.length) continue
        for (const r of batch) {
          if (!seen.has(r.hora_sensor_utc)) {
            seen.add(r.hora_sensor_utc)
            allRows.push(r)
          }
        }
      }

      const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
      const monthlyMap = {}
      const hourlyMap = {}
      const dist = { good: 0, moderate: 0, usg: 0, unhealthy: 0, veryUnhealthy: 0, hazardous: 0 }

      for (const row of allRows) {
        const dt = new Date(row.hora_sensor_utc.replace(' ', 'T') + 'Z')
        const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
        const h = dt.getUTCHours()
        const aqi = parseFloat(row.aqi) || 0

        if (!monthlyMap[key]) monthlyMap[key] = { aqi: [], pm1: [], pm25: [], pm10: [], temp: [], hum: [] }
        monthlyMap[key].aqi.push(aqi)
        monthlyMap[key].pm1.push(parseFloat(row.pm1) || 0)
        monthlyMap[key].pm25.push(parseFloat(row.pm2_5) || 0)
        monthlyMap[key].pm10.push(parseFloat(row.pm10) || 0)
        monthlyMap[key].temp.push(parseFloat(row.temperatura) || 0)
        monthlyMap[key].hum.push(parseFloat(row.humedad) || 0)

        if (!hourlyMap[h]) hourlyMap[h] = { aqi: [], pm25: [] }
        hourlyMap[h].aqi.push(aqi)
        hourlyMap[h].pm25.push(parseFloat(row.pm2_5) || 0)

        if (aqi <= 50) dist.good++
        else if (aqi <= 100) dist.moderate++
        else if (aqi <= 150) dist.usg++
        else if (aqi <= 200) dist.unhealthy++
        else if (aqi <= 300) dist.veryUnhealthy++
        else dist.hazardous++
      }

      const total = allRows.length
      const pct = n => total > 0 ? +((n / total) * 100).toFixed(1) : 0

      const monthly = Object.entries(monthlyMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, d]) => ({
          month,
          aqi: +avg(d.aqi).toFixed(1),
          pm1: +avg(d.pm1).toFixed(1),
          pm25: +avg(d.pm25).toFixed(1),
          pm10: +avg(d.pm10).toFixed(1),
          temp: +avg(d.temp).toFixed(1),
          hum: +avg(d.hum).toFixed(1),
        }))

      const hourly = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        aqi: hourlyMap[h] ? +avg(hourlyMap[h].aqi).toFixed(1) : 0,
        pm25: hourlyMap[h] ? +avg(hourlyMap[h].pm25).toFixed(1) : 0,
      }))

      let sumAqi = 0, sumPm25 = 0, sumPm10 = 0, sumTemp = 0, sumHum = 0
      let maxPm25 = 0, maxPm10 = 0
      for (const r of allRows) {
        const a = parseFloat(r.aqi) || 0
        const p25 = parseFloat(r.pm2_5) || 0
        const p10 = parseFloat(r.pm10) || 0
        sumAqi  += a
        sumPm25 += p25
        sumPm10 += p10
        sumTemp += parseFloat(r.temperatura) || 0
        sumHum  += parseFloat(r.humedad) || 0
        if (p25 > maxPm25) maxPm25 = p25
        if (p10 > maxPm10) maxPm10 = p10
      }
      const n = allRows.length || 1

      return res.json({
        total,
        monthly,
        hourly,
        distribution: {
          good:          pct(dist.good),
          moderate:      pct(dist.moderate),
          usg:           pct(dist.usg),
          unhealthy:     pct(dist.unhealthy),
          veryUnhealthy: pct(dist.veryUnhealthy),
          hazardous:     pct(dist.hazardous),
        },
        overallAvg: {
          aqi:    +(sumAqi  / n).toFixed(1),
          pm25:   +(sumPm25 / n).toFixed(1),
          pm10:   +(sumPm10 / n).toFixed(1),
          temp:   +(sumTemp / n).toFixed(1),
          hum:    +(sumHum  / n).toFixed(1),
          maxPm25: +maxPm25.toFixed(0),
          maxPm10: +maxPm10.toFixed(0),
        },
      })
    }

    if (type === 'heatmap') {
      const from  = req.query.from
      const to    = req.query.to
      const group = req.query.group ?? 'day'

      const cacheKey = `${from}|${to}|${group}`
      const cached = heatmapCache.get(cacheKey)
      if (cached && Date.now() - cached.ts < HEATMAP_CACHE_TTL) {
        return res.json(cached.data)
      }

      const batchSize = 1000

      let baseParams = `?select=hora_sensor_utc,aqi`
      if (from) baseParams += `&hora_sensor_utc=gte.${encodeURIComponent(from + ' 00:00:00')}`
      if (to)   baseParams += `&hora_sensor_utc=lte.${encodeURIComponent(to   + ' 23:59:59')}`

      const baseUrl = `${SUPABASE_URL}/rest/v1/lecturas_davis${baseParams}`

      // 1. Obtener total de filas para construir offsets
      const totalCount = await supabaseCount(baseUrl)

      // 2. Disparar todos los batches en paralelo
      const offsets = []
      for (let o = 0; o < Math.max(totalCount, 1); o += batchSize) offsets.push(o)

      const heatmapUrls = offsets.map(offset =>
        `${SUPABASE_URL}/rest/v1/lecturas_davis${baseParams}` +
        `&order=hora_sensor_utc.asc&limit=${batchSize}&offset=${offset}`
      )
      const batches = await fetchInChunks(heatmapUrls)

      // 3. Unir y deduplicar
      const seen = new Set()
      const allRows = []
      for (const batch of batches) {
        if (!batch?.length) continue
        for (const r of batch) {
          if (!seen.has(r.hora_sensor_utc)) {
            seen.add(r.hora_sensor_utc)
            allRows.push(r)
          }
        }
      }

      const buckets = {}
      let aqiSum = 0, aqiMin = Infinity, aqiMax = -Infinity

      for (const row of allRows) {
        const dt  = new Date(row.hora_sensor_utc.replace(' ', 'T') + 'Z')
        const h   = dt.getUTCHours()
        const aqi = parseFloat(row.aqi) || 0
        const key = group === 'month'
          ? `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
          : `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
        if (!buckets[key]) buckets[key] = {}
        if (!buckets[key][h]) buckets[key][h] = []
        buckets[key][h].push(aqi)
        aqiSum += aqi
        if (aqi < aqiMin) aqiMin = aqi
        if (aqi > aqiMax) aqiMax = aqi
      }

      const labels = Object.keys(buckets).sort()
      const avgArr = arr => arr.reduce((a, b) => a + b, 0) / arr.length

      const matrix = Array.from({ length: 24 }, (_, h) =>
        labels.map(lbl => {
          const arr = buckets[lbl]?.[h]
          return arr?.length ? +avgArr(arr).toFixed(1) : null
        })
      )

      const n = allRows.length
      const result = {
        labels,
        matrix,
        total: n,
        summary: {
          avg: n ? +(aqiSum / n).toFixed(1) : 0,
          min: n ? +aqiMin.toFixed(1) : 0,
          max: n ? +aqiMax.toFixed(1) : 0,
        },
      }

      heatmapCache.set(cacheKey, { ts: Date.now(), data: result })
      return res.json(result)
    }

    res.status(400).json({ error: 'type must be latest, history, historico, or heatmap' })
  } catch (err) {
    console.error('API error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

//  Predicción AQI +1 hora (Python) 
app.get('/api/prediccion', async (req, res) => {
  try {
    const response = await fetch('http://127.0.0.1:5000/predecir', {
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`Python API ${response.status}`)
    const data = await response.json()
    res.json(data)
  } catch (err) {
    console.error('Error prediccion:', err.message)
    res.status(500).json({ error: err.message })
  }
})

//  Datos del modelo: y_real vs y_predicho 
function parsearCSV(ruta) {
  const lineas  = readFileSync(ruta, 'utf8').trim().split('\n')
  const headers = lineas[0].split(',').map(h => h.trim())
  return lineas.slice(1).map(linea => {
    const vals = linea.split(',')
    const fila = {}
    headers.forEach((h, i) => {
      const raw = (vals[i] || '').trim()
      fila[h]  = isNaN(raw) || raw === '' ? raw : parseFloat(raw)
    })
    return fila
  })
}


app.get('/api/modelo', (req, res) => {
  //const ruta = new URL('./static_data/predicciones_test.csv', import.meta.url).pathname
  const ruta = join(__dirname, 'static_data', 'predicciones_test.csv')
  console.log('Buscando CSV en:', ruta)
  console.log('Existe:', existsSync(ruta))
  if (!existsSync(ruta)) {
    return res.status(404).json({ error: 'CSV no encontrado.' })
  }
  const datos = parsearCSV(ruta)
  res.json(datos)
})

// ── Gemini AI — helpers ────────────────────────────────────────────────

function getMexicoTime() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
  const dia = d.getDay() === 0 ? 6 : d.getDay() - 1  // 0=lunes…6=domingo
  return { hora: d.getHours(), minuto: d.getMinutes(), dia }
}

function getContextoEscom(hora, minuto, dia) {
  const totalMin = hora * 60 + minuto
  const RECESOS = [[10 * 60, 10 * 60 + 30], [18 * 60, 18 * 60 + 30]]
  const CAMBIOS = [7 * 60, 8 * 60 + 30, 10 * 60 + 30, 12 * 60, 13 * 60 + 30, 15 * 60, 16 * 60 + 30, 18 * 60 + 30, 20 * 60]

  if (dia >= 5) return { descripcion: 'Fin de semana — actividad muy baja en escuela|', esReceso: false, esCambio: false }
  if (hora < 7)  return { descripcion: 'Escuela cerrada — horas de madrugada', esReceso: false, esCambio: false }
  if (hora >= 21) return { descripcion: 'Fin de jornada académica', esReceso: false, esCambio: false }

  const esReceso = RECESOS.some(([ini, fin]) => totalMin >= ini && totalMin < fin)
  if (esReceso) return { descripcion: 'Hora de receso — estudiantes en exteriores del escuela', esReceso: true, esCambio: false }

  const esCambio = CAMBIOS.some(c => Math.abs(totalMin - c) <= 5)
  if (esCambio) {
    const esNocturno = hora >= 18
    return {
      descripcion: esNocturno
        ? 'Cambio de clase nocturno — actividad baja en escuela'
        : 'Cambio de clase — alto tránsito por pasillos y patios',
      esReceso: false,
      esCambio: true,
      esNocturno,
    }
  }

  if (hora >= 7 && hora <= 9) return { descripcion: 'Hora pico matutina — alta afluencia en escuela', esReceso: false, esCambio: false }
  if (hora >= 12 && hora <= 13) return { descripcion: 'Horario de comida — estudiantes posiblemente en exteriores', esReceso: false, esCambio: false }
  return { descripcion: 'Horario de clases normal — estudiantes principalmente en aulas', esReceso: false, esCambio: false }
}

function buildGeminiPrompt(ultima, historial, ctx) {
  const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
  const { hora, minuto, dia } = ctx.tiempo
  const diaStr = DIAS[dia] ?? 'Desconocido'

  // Tendencia AQI sobre el historial disponible
  let tendencia = 'estable →'
  let deltaAqi = 0
  if (historial.length >= 3) {
    const aqis = historial.slice(0, 4).map(r => parseFloat(r.aqi) || 0)
    deltaAqi = +(aqis[0] - aqis[Math.min(3, aqis.length - 1)]).toFixed(1)
    tendencia = deltaAqi > 5 ? 'subiendo ↑' : deltaAqi < -5 ? 'bajando ↓' : 'estable →'
  }

  const historialStr = historial.slice(0, 6).map((r, i) => {
    const label = i === 0 ? 'Actual' : `Hace ~${i * 5} min`
    return `  [${label}] AQI: ${Math.round(parseFloat(r.aqi))}, PM2.5: ${parseFloat(r.pm2_5).toFixed(1)} µg/m³`
  }).join('\n')

  const pm25 = parseFloat(ultima.pm2_5).toFixed(1)
  const pm10 = parseFloat(ultima.pm10).toFixed(1)
  const pm1  = parseFloat(ultima.pm1 || 0).toFixed(1)
  const aqi  = Math.round(parseFloat(ultima.aqi))
  const temp = parseFloat(ultima.temperatura).toFixed(1)
  const hum  = parseFloat(ultima.humedad).toFixed(0)

  const bandaNOM = aqi <= 50 ? 'Buena' : aqi <= 100 ? 'Aceptable' : aqi <= 150 ? 'Mala para grupos sensibles' : aqi <= 200 ? 'No saludable' : 'Muy no saludable'

  const systemInstruction = `Experto en calidad del aire para escuela ESCOM-IPN Isla de Datos Urbanos, CDMX. Basa tus recomendaciones en la NOM-172-SEMARNAT-2019 (NO LO MENCIONES EN LAS RECOMENDACIONES) Responde SOLO con JSON válido en español, sin markdown.
Estructura exacta:
{"resumen":"<1 oración>","nivel_riesgo":"bajo|moderado|alto|muy_alto","recomendaciones_generales":["<máx 2 oraciones>","..."],"recomendaciones_grupos_sensibles":["<asma/EPOC/adultos mayores>"],"acciones_inmediatas":[],"mensaje_contexto":"<contexto horario campus>"}`

  const receso = ctx.escom.esReceso ? ' RECESO: estudiantes en exteriores.' : ''
  const cambio = ctx.escom.esCambio
    ? (ctx.escom.esNocturno ? ' CAMBIO DE CLASE NOCTURNO: pocos estudiantes en campus.' : ' CAMBIO DE CLASE: alto tránsito.')
    : ''
  const humo = ctx.humo ? ' HUMO detectado por cámara.' : ''

  const predStr = ctx.aqiPrediccion !== null && ctx.aqiPrediccion !== undefined
    ? ` | Predicción AQI +1h: ${ctx.aqiPrediccion}`
    : ''

  const userMessage = `ESCOM IPN | ${diaStr} ${hora}:${String(minuto).padStart(2, '0')}h | ${ctx.escom.descripcion}${receso}${cambio}${humo}
AQI:${aqi}(${bandaNOM}) PM2.5:${pm25}µg/m³ PM10:${pm10}µg/m³ Temp:${temp}°C Hum:${hum}%
Tendencia:${tendencia}(Δ${deltaAqi > 0 ? '+' : ''}${deltaAqi}) | Historial(AQI): ${historial.slice(0, 4).map(r => Math.round(parseFloat(r.aqi))).join('→')}${predStr}
${ctx.personas > 0 ? `Personas exterior: ${ctx.personas}` : ''}
Genera recomendaciones. "acciones_inmediatas":[] si nivel no es alto/muy_alto.`

  return { systemInstruction, userMessage }
}

function escapeNewlinesInStrings(jsonStr) {
  let result = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i]
    if (escaped) { result += ch; escaped = false; continue }
    if (ch === '\\' && inString) { result += ch; escaped = true; continue }
    if (ch === '"') { inString = !inString; result += ch; continue }
    if (inString && (ch === '\n' || ch === '\r')) { result += '\\n'; continue }
    result += ch
  }
  return result
}

function parseGeminiJSON(text) {
  const clean = text.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()

  // Direct parse first
  try { return JSON.parse(clean) } catch {}

  // Fix literal newlines inside strings and retry
  try { return JSON.parse(escapeNewlinesInStrings(clean)) } catch {}

  // Extract first {...} block, fix newlines, retry
  const match = clean.match(/\{[\s\S]*\}/)
  if (match) {
    try { return JSON.parse(escapeNewlinesInStrings(match[0])) } catch {}
  }

  throw new Error(`JSON inválido en respuesta de Gemini: ${clean.slice(0, 120)}`)
}

async function fetchGeminiWithRetry(body, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    })
    if (res.ok) return res
    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10)
      const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(2 ** attempt * 1000, 16000)
      console.warn(`Gemini 429 — reintento ${attempt}/${maxRetries} en ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
      continue
    }
    const errBody = await res.text()
    throw new Error(`Gemini API ${res.status}: ${errBody.slice(0, 300)}`)
  }
}

// ── Árbol de decisión — fallback cuando Gemini falla ──────────────────

function buildArbolFallback(ultima, escom) {
  const pm25 = parseFloat(ultima.pm2_5) || 0
  const aqi  = Math.round(parseFloat(ultima.aqi))
  const banda = bandaDesPm25(pm25)

  const nivel_riesgo = aqi <= 50 ? 'bajo' : aqi <= 100 ? 'moderado' : aqi <= 150 ? 'alto' : 'muy_alto'
  const emojis = { bajo: '😊', moderado: '😐', alto: '😷', muy_alto: '🚨' }

  const recsGenerales = [banda.mensaje_general]
  if (banda.mensaje_expuesto) recsGenerales.push(banda.mensaje_expuesto)

  const accionesInmediatas = aqi > 150
    ? ['Evite exposición prolongada al aire libre', 'Use mascarilla N95 si debe salir']
    : []

  return {
    resumen: banda.mensaje_general,
    nivel_riesgo,
    emoji_estado: emojis[nivel_riesgo],
    recomendaciones_generales: recsGenerales,
    recomendaciones_grupos_sensibles: banda.mensaje_expuesto ? [banda.mensaje_expuesto] : [],
    acciones_inmediatas: accionesInmediatas,
    mensaje_contexto: banda.contexto ?? escom.descripcion,
    timestamp: ultima.hora_sensor_utc,
    pm25,
    aqi,
    fuente: 'arbol',
    fromCache: false,
    generatedAt: new Date().toISOString(),
  }
}

// ── Gemini AI — endpoint ────────────────────────────────────────────────

app.get('/api/ia/recomendacion', async (req, res) => {
  const forceRefresh = req.query.refresh === 'true'

  try {
    const url =
      `${SUPABASE_URL}/rest/v1/lecturas_davis` +
      `?select=hora_sensor_utc,pm2_5,pm10,pm1,temperatura,humedad,aqi` +
      `&order=hora_sensor_utc.desc&limit=10`

    const rows = await supabaseFetch(url)
    if (!rows?.length) return res.status(404).json({ error: 'Sin datos de sensores disponibles' })

    const ultima = rows[0]
    const aqiActual = Math.round(parseFloat(ultima.aqi))
    const bandActual = aqiActual <= 50 ? 'Buena' : aqiActual <= 100 ? 'Aceptable' : aqiActual <= 150 ? 'Grupos sensibles' : aqiActual <= 200 ? 'No saludable' : 'Muy no saludable'

    const { hora, minuto, dia } = getMexicoTime()
    const escom = getContextoEscom(hora, minuto, dia)

    if (!forceRefresh && geminiCache.data) {
      // Si Supabase no tiene datos nuevos → caché directo, sin llamar a Gemini
      if (ultima.hora_sensor_utc === geminiCache.lastDataTimestamp) {
        return res.json({ ...geminiCache.data, fromCache: true })
      }

      // Hay dato nuevo de Supabase — solo llamar a Gemini si AQI o banda cambiaron significativamente
      const aqiSinCambio = Math.abs(aqiActual - (geminiCache.lastAqi ?? 0)) < GEMINI_AQI_DELTA
      const bandSinCambio = bandActual === (geminiCache.lastBand ?? '')
      if (aqiSinCambio && bandSinCambio) {
        // Actualizar el puntero de datos pero reusar la recomendación anterior
        geminiCache.lastDataTimestamp = ultima.hora_sensor_utc
        geminiCache.lastAqi = aqiActual
        geminiCache.lastBand = bandActual
        return res.json({ ...geminiCache.data, fromCache: true })
      }
    }

    if (GEMINI_API_KEY) {
      try {
        let aqiPrediccion = null
        try {
          const predRes = await fetch('http://127.0.0.1:5000/predecir', { signal: AbortSignal.timeout(5000) })
          if (predRes.ok) {
            const predData = await predRes.json()
            aqiPrediccion = predData.aqi_predicho ?? null
            if (aqiPrediccion !== null) aqiPrediccion = Math.round(parseFloat(aqiPrediccion))
          }
        } catch { /* Python no disponible — continuar sin predicción */ }

        let personas = 0
        let humo = false
        try {
          const camRes = await fetch('http://192.168.100.180:5000/status', { signal: AbortSignal.timeout(3000) })
          if (camRes.ok) {
            const camData = await camRes.json()
            personas = camData.personas ?? 0
            humo = camData.hay_cigarro ?? false
          }
        } catch { /* Cámara no disponible — continuar sin datos de visión */ }

        const ctx = { tiempo: { hora, minuto, dia }, escom, personas, humo, aqiPrediccion }
        const { systemInstruction, userMessage } = buildGeminiPrompt(ultima, rows, ctx)

        const geminiRes = await fetchGeminiWithRetry({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingBudget: 0 },
          },
        })

        const geminiData = await geminiRes.json()
        const candidate = geminiData.candidates?.[0]
        const finishReason = candidate?.finishReason
        const rawText = candidate?.content?.parts?.[0]?.text
        if (finishReason === 'MAX_TOKENS') {
          throw new Error(`Gemini cortó la respuesta por límite de tokens (MAX_TOKENS). rawText: ${JSON.stringify(rawText?.slice(0, 200))}`)
        }
        if (!rawText) throw new Error('Gemini no retornó contenido en la respuesta')

        const iaRec = parseGeminiJSON(rawText)
        const result = {
          ...iaRec,
          timestamp: ultima.hora_sensor_utc,
          pm25: parseFloat(ultima.pm2_5),
          aqi: aqiActual,
          contexto_universitario: escom.descripcion,
          fuente: 'gemini',
          fromCache: false,
          generatedAt: new Date().toISOString(),
        }

        geminiCache = { data: result, lastDataTimestamp: ultima.hora_sensor_utc, lastAqi: aqiActual, lastBand: bandActual }
        return res.json(result)
      } catch (geminiErr) {
        console.warn('Gemini falló, usando árbol de decisión:', geminiErr.message)
      }
    }

    // Fallback: árbol de decisión local
    return res.json(buildArbolFallback(ultima, escom))
  } catch (err) {
    console.error('IA Recomendación error:', err.message)
    if (geminiCache.data) {
      return res.json({ ...geminiCache.data, fromCache: true, cacheExpired: true })
    }
    res.status(500).json({ error: 'Error al generar recomendación', detail: err.message })
  }
})


app.listen(PORT, () => console.log(`Backend corriendo en http://localhost:${PORT}`))
