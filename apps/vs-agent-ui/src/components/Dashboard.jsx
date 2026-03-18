import { useState, useEffect } from 'react'
import { resolveVTCType, resolveJSCType } from '@verana-labs/vs-agent-model/ecs'
import { getAgentConfig, getDidDocument, qrUrl } from '../api'

function JsonModal({ data, onClose }) {
  const [copied, setCopied] = useState(false)
  const json = JSON.stringify(data, null, 2)

  function copy() {
    navigator.clipboard.writeText(json)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 780, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>JSON</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
        <pre style={{ flex: 1, overflow: 'auto', fontSize: 12, fontFamily: "'Fira Code', 'Courier New', monospace", background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {json}
        </pre>
      </div>
    </div>
  )
}

function CredentialCard({ vc, onSelect }) {
  const subject = vc?.credentialSubject ?? {}
  const attrs = Object.entries(subject).filter(([k]) => k !== 'id')
  const schemaId = vc?.credentialSchema?.id ?? ''

  return (
    <div className="cred-card" onClick={onSelect} style={{ cursor: 'pointer' }}>
      {schemaId && (
        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 10, wordBreak: 'break-all' }}>
          {schemaId}
        </div>
      )}
      <div className="cred-card-attrs">
        <table>
          <tbody>
            {subject.id && (
              <tr>
                <td title="id">id</td>
                <td style={{ whiteSpace: 'normal', wordBreak: 'break-all' }}>{subject.id}</td>
              </tr>
            )}
            {attrs.map(([key, value]) => {
              const display = typeof value === 'object' ? JSON.stringify(value) : String(value)
              return (
                <tr key={key}>
                  <td title={key}>{key}</td>
                  <td title={display}>{display}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

async function resolveCVpService(service) {
  try {
    const vp = await fetch(service.serviceEndpoint).then(r => r.ok ? r.json() : null)
    if (!vp) return { service, type: 'other', credentials: [] }
    const raw = vp.verifiableCredential
    const vcs = Array.isArray(raw) ? raw : (raw ? [raw] : [])
    const type = vcs.length > 0 ? await resolveVTCType({ credential: vcs[0] }) : 'other'
    return { service, type, credentials: vcs }
  } catch {
    return { service, type: 'other', credentials: [] }
  }
}

async function resolveJscVpService(service) {
  try {
    const vp = await fetch(service.serviceEndpoint).then(r => r.ok ? r.json() : null)
    if (!vp) return { service, type: 'other', credentials: [] }
    const raw = vp.verifiableCredential
    const vcs = Array.isArray(raw) ? raw : (raw ? [raw] : [])
    const type = vcs.length > 0 ? await resolveJSCType({ credential: vcs[0] }) : 'other'
    return { service, type, credentials: vcs }
  } catch {
    return { service, type: 'other', credentials: [] }
  }
}

function groupByType(items) {
  return items.reduce((acc, item) => {
    acc[item.type] = acc[item.type] ?? []
    acc[item.type].push(item)
    return acc
  }, {})
}

function CredentialSection({ title, items, renderItem }) {
  if (items.length === 0) return null
  const grouped = groupByType(items)
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 className="section-title">{title}</h2>
      {Object.entries(grouped).map(([type, group]) => (
        <div key={type} className="cred-group">
          <div className="cred-group-title">{type}</div>
          <div className="cred-cards">
            {group.map((item, i) => renderItem(item, i))}
          </div>
        </div>
      ))}
    </section>
  )
}

export default function Dashboard() {
  const agentConfig = getAgentConfig()
  const [doc, setDoc] = useState(null)
  const [cvpItems, setCvpItems] = useState([])
  const [jscItems, setJscItems] = useState([])
  const [credsLoading, setCredsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    getDidDocument()
      .then(d => {
        setDoc(d)
        const vprServices = (d.service ?? []).filter(s => (s.id?.split('#')[1] ?? '').startsWith('vpr'))
        const cvp = vprServices.filter(s => (s.id?.split('#')[1] ?? '').endsWith('-c-vp'))
        const jsc = vprServices.filter(s => (s.id?.split('#')[1] ?? '').endsWith('-jsc-vp'))

        Promise.all(cvp.map(resolveCVpService)).then(setCvpItems)
        Promise.all(jsc.map(resolveJscVpService))
          .then(setJscItems)
          .finally(() => setCredsLoading(false))
      })
      .catch(err => setError(err.message))
  }, [])

  if (error) return <p className="error-msg">{error}</p>
  if (!doc) return <p className="loading">Loading...</p>

  const endpoints = (doc.service ?? [])
    .filter(s => s.type === 'did-communication')
    .map(s => s.serviceEndpoint)
  const webDid = (doc.alsoKnownAs ?? []).find(d => d.startsWith('did:webvh:')) ?? doc.id

  const noCredentials = !credsLoading && cvpItems.length === 0 && jscItems.length === 0

  return (
    <div>
      {selected && <JsonModal data={selected} onClose={() => setSelected(null)} />}

      {agentConfig.welcomeMessage && (
        <h1 style={{ fontSize: 32, fontWeight: 700, color: '#111827', marginBottom: 28, textAlign: 'center' }}>
          {agentConfig.welcomeMessage}
        </h1>
      )}

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: '#111827', marginBottom: 16, textAlign: 'center' }}>
          VS Agent Information
        </h2>

        <div className="agent-info-card">
          <div className="agent-info-row">
            <span className="agent-info-label">Name</span>
            <span className="agent-info-value">{agentConfig.label}</span>
          </div>

          <div className="agent-info-row">
            <span className="agent-info-label">Public DID</span>
            <span className="agent-info-value agent-info-mono">
              {webDid ?? <span style={{ color: '#9ca3af' }}>Not assigned</span>}
            </span>
          </div>

          {endpoints.length > 0 && (
            <div className="agent-info-row">
              <span className="agent-info-label">Endpoints</span>
              <span className="agent-info-value agent-info-mono">
                {endpoints.join(', ')}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 24 }}>
            <div style={{ textAlign: 'center' }}>
              <img src={qrUrl} alt="Invitation QR" style={{ width: 280, height: 280, display: 'block' }} />
              <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>Scan to connect</p>
            </div>
          </div>
        </div>
      </section>

      {credsLoading && <p className="loading">Loading credentials...</p>}

      {noCredentials && <p className="empty-msg">No credentials found.</p>}

      <CredentialSection
        title="Linked Credentials"
        items={cvpItems}
        renderItem={(item, i) =>
          item.credentials.map((vc, j) => (
            <CredentialCard key={`${i}-${j}`} vc={vc} onSelect={() => setSelected(vc)} />
          ))
        }
      />

      <CredentialSection
        title="Schema Credentials"
        items={jscItems}
        renderItem={(item, i) => (
          <div key={i} className="cred-card" onClick={() => setSelected(item.service)} style={{ cursor: 'pointer' }}>
            <div style={{ fontSize: 12, color: '#6b7280', wordBreak: 'break-all' }}>
              {item.service.serviceEndpoint}
            </div>
          </div>
        )}
      />
    </div>
  )
}
