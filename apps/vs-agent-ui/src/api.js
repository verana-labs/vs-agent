export async function getDidDocument() {
  const res = await fetch('/.well-known/did.json')
  if (!res.ok) throw new Error('Failed to fetch DID document')
  return res.json()
}

// Runtime config the agent injects into index.html as window.__VS_AGENT__.
// The fallback applies to the Vite dev server, which serves index.html as is.
export function getAgentConfig() {
  return (
    window.__VS_AGENT__ ?? {
      build: null,
      version: null,
      networkBadge: null,
      showPlaceholderMessage: false,
      network: null,
    }
  )
}
