// ─────────────────────────────────────────────────────────────────────
// PARCHE: agregar después de los imports existentes en server.js
// No modificar nada más. Solo agregar este bloque al final,
// antes del app.listen().
// ─────────────────────────────────────────────────────────────────────

const MOTOR_URL = process.env.MOTOR_URL || 'http://localhost:8000'

// Proxy ligero: recibe la petición del dashboard y la reenvía al motor Python.
// El motor devuelve JSON directamente — solo lo pasamos.
app.get('/api/recomendacion', async (req, res) => {
  const esReceso = req.query.es_receso === 'true' ? 'true' : 'false'

  try {
    const resp = await fetch(
      `${MOTOR_URL}/api/recomendacion?es_receso=${esReceso}`,
      { signal: AbortSignal.timeout(8000) }
    )

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }))
      return res.status(resp.status).json({ error: err.detail ?? 'Error del motor' })
    }

    const data = await resp.json()
    return res.json(data)

  } catch (err) {
    console.error('[/api/recomendacion]', err.message)
    return res.status(503).json({ error: 'Motor de recomendaciones no disponible' })
  }
})

// Health check del motor (útil para el dashboard)
app.get('/api/recomendacion/estado', async (req, res) => {
  try {
    const resp = await fetch(
      `${MOTOR_URL}/api/recomendacion/estado`,
      { signal: AbortSignal.timeout(4000) }
    )
    const data = await resp.json()
    return res.json(data)
  } catch {
    return res.status(503).json({
      status: 'offline',
      listo: false,
      mensaje: 'Motor Python no responde'
    })
  }
})

// ─────────────────────────────────────────────────────────────────────
// En .env agregar:
//   MOTOR_URL=http://localhost:8000
// ─────────────────────────────────────────────────────────────────────
