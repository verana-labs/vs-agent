const BASE = '/v1'

export async function getAgent() {
  const res = await fetch(`${BASE}/agent/`)
  if (!res.ok) throw new Error('Failed to fetch agent info')
  return res.json()
}

export async function getHealth() {
  const res = await fetch(`${BASE}/health`)
  if (!res.ok) throw new Error('Failed to fetch health')
  return res.json()
}

export async function getConnections() {
  const res = await fetch(`${BASE}/connections/`)
  if (!res.ok) throw new Error('Failed to fetch connections')
  return res.json()
}

export async function getCredentials() {
  const res = await fetch(`${BASE}/vt/linked-credentials`)
  if (!res.ok) throw new Error('Failed to fetch credentials')
  return res.json()
}

export async function updateCredential(credential) {
  const res = await fetch(`${BASE}/vt/linked-credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credential),
  })
  if (!res.ok) throw new Error('Failed to update credential')
  return res.json()
}

export async function deleteCredential(schemaId) {
  const res = await fetch(`${BASE}/vt/linked-credentials?schemaId=${encodeURIComponent(schemaId)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete credential')
}

export const qrUrl = `${BASE}/qr/`
