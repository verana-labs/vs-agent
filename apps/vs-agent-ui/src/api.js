export async function getDidDocument() {
  const res = await fetch('/.well-known/did.json')
  if (!res.ok) throw new Error('Failed to fetch DID document')
  return res.json()
}

export const qrUrl = '/qr'
