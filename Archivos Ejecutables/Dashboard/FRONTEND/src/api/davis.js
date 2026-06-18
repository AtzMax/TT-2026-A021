export async function fetchLatest() {
  const res = await fetch('/api/davis?type=latest', { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchHistory() {
  const res = await fetch('/api/davis?type=history', { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchRecomendacion() {
  const res = await fetch('/api/recomendacion', { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchPrediccion() {
  const res = await fetch('/api/prediccion', { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchIARecomendacion(force = false) {
  const url = force ? '/api/ia/recomendacion?refresh=true' : '/api/ia/recomendacion'
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? body.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}
