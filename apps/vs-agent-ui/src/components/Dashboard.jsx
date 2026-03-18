import { useState, useEffect } from 'react'
import { identifySchema, resolveCredentialType } from '@verana-labs/vs-agent-model/ecs'
import { getDidDocument, qrUrl } from '../api'

function CredentialCard({ vc }) {
  const subject = vc?.credentialSubject ?? {}
  const attrs = Object.entries(subject).filter(([k]) => k !== 'id')
  const schemaId = vc?.credentialSchema?.id ?? ''

  return (
    <div className="cred-card">
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

async function resolveCvpService(service) {
  try {
    const vp = await fetch(service.serviceEndpoint).then(r => r.ok ? r.json() : null)
    if (!vp) return { service, type: 'other', credentials: [] }
    const raw = vp.verifiableCredential
    const vcs = Array.isArray(raw) ? raw : (raw ? [raw] : [])
    const type = vcs.length > 0 ? await resolveCredentialType({ credential: vcs[0] }) : 'other'
    return { service, type, credentials: vcs }
  } catch {
    return { service, type: 'other', credentials: [] }
  }
}

async function resolveJscService(service) {
  try {
    const schema = await fetch(service.serviceEndpoint).then(r => r.ok ? r.json() : null)
    if (!schema) return { service, type: 'other' }
    const type = (await identifySchema(schema)) ?? 'other'
    return { service, type }
  } catch {
    return { service, type: 'other' }
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
  const [doc, setDoc] = useState(null)
  const [cvpItems, setCvpItems] = useState([])
  const [jscItems, setJscItems] = useState([])
  const [credsLoading, setCredsLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    getDidDocument()
      .then(d => {
        setDoc(d)
        const vprServices = (d.service ?? []).filter(s => (s.id?.split('#')[1] ?? '').startsWith('vpr'))
        const cvp = vprServices.filter(s => (s.id?.split('#')[1] ?? '').endsWith('-c-vp'))
        const jsc = vprServices.filter(s => (s.id?.split('#')[1] ?? '').endsWith('-jsc-vp'))

        Promise.all(cvp.map(resolveCvpService)).then(setCvpItems)
        Promise.all(jsc.map(resolveJscService))
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

  const noCredentials = !credsLoading && cvpItems.length === 0 && jscItems.length === 0

  return (
    <div>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Monitor and manage your VS Agent configuration
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 16 }}>
          VS Agent Information
        </h2>

        <div className="agent-info-card">
          <div className="agent-info-row">
            <span className="agent-info-label">Public DID</span>
            <span className="agent-info-value agent-info-mono">
              {doc.id ?? <span style={{ color: '#9ca3af' }}>Not assigned</span>}
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
              <img src={qrUrl} alt="Invitation QR" style={{ width: 200, height: 200, display: 'block' }} />
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
            <CredentialCard key={`${i}-${j}`} vc={vc} />
          ))
        }
      />

      <CredentialSection
        title="Schema Credentials"
        items={jscItems}
        renderItem={(item, i) => (
          <div key={i} className="cred-card">
            <div style={{ fontSize: 12, color: '#6b7280', wordBreak: 'break-all' }}>
              {item.service.serviceEndpoint}
            </div>
          </div>
        )}
      />
    </div>
  )
}
