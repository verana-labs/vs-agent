import { useState, useEffect } from 'react'
import { identifySchema, resolveCredentialType } from '@verana-labs/vs-agent-model/ecs'
import { getDidDocument } from '../api'

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
                <td title={subject.id}>{subject.id}</td>
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

export default function Credentials() {
  const [cvpItems, setCvpItems] = useState([])
  const [jscItems, setJscItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    getDidDocument()
      .then(doc => {
        const vprServices = (doc.service ?? []).filter(s => (s.id?.split('#')[1] ?? '').startsWith('vpr'))
        const cvp = vprServices.filter(s => (s.id?.split('#')[1] ?? '').endsWith('-c-vp'))
        const jsc = vprServices.filter(s => (s.id?.split('#')[1] ?? '').endsWith('-jsc-vp'))

        Promise.all(cvp.map(resolveCvpService)).then(setCvpItems)
        Promise.all(jsc.map(resolveJscService)).then(setJscItems)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="loading">Loading...</p>
  if (error) return <p className="error-msg">{error}</p>
  if (cvpItems.length === 0 && jscItems.length === 0) return <p className="empty-msg">No credentials found.</p>

  return (
    <div>
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
