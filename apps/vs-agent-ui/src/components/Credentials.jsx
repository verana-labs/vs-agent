import { useState, useEffect } from 'react'
import { getCredentials, updateCredential, deleteCredential } from '../api'

const TYPES = ['organization', 'service', 'persona', 'useragent']

function getCredentialType(item) {
  const schemaId = (item.schemaId ?? '').toLowerCase()
  for (const t of TYPES) {
    if (schemaId.includes(t)) return t
  }
  const types = item.credential?.type ?? []
  for (const t of types) {
    const lower = t.toLowerCase()
    for (const known of TYPES) {
      if (lower.includes(known)) return known
    }
  }
  return 'other'
}

function CredentialCard({ item, onEdit, onDelete }) {
  const subject = item.credential?.credentialSubject ?? {}
  const attrs = Object.entries(subject).filter(([k]) => k !== 'id')
  const schemaId = item.schemaId ?? item.credential?.credentialSchema?.id ?? ''

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
      <div className="cred-card-actions">
        <button className="btn btn-edit" onClick={() => onEdit(item)}>Edit</button>
        <button className="btn btn-delete" onClick={() => onDelete(item)}>Delete</button>
      </div>
    </div>
  )
}

function EditModal({ item, onSave, onClose }) {
  const [value, setValue] = useState(JSON.stringify(item.credential, null, 2))
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    try {
      const parsed = JSON.parse(value)
      setSaving(true)
      const schemaBaseId = item.schemaId?.match(/schemas-(.+?)-c-vp/)?.[1] ?? 'unknown'
      await updateCredential({ schemaBaseId, credential: parsed })
      onSave()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Edit Credential</h2>
        {error && <p className="error-msg">{error}</p>}
        <textarea value={value} onChange={e => setValue(e.target.value)} />
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CreateForm({ onCreate }) {
  const [type, setType] = useState(TYPES[0])
  const [json, setJson] = useState('{\n  \n}')
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)

  const handleSubmit = async () => {
    try {
      const credential = JSON.parse(json)
      setCreating(true)
      await updateCredential({ schemaBaseId: type, credential })
      setJson('{\n  \n}')
      setError(null)
      onCreate()
    } catch (e) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="create-form">
      <h2>Create Credential</h2>
      {error && <p className="error-msg">{error}</p>}
      <div className="form-group">
        <label>Type</label>
        <select value={type} onChange={e => setType(e.target.value)}>
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label>W3C Credential (JSON)</label>
        <textarea value={json} onChange={e => setJson(e.target.value)} />
      </div>
      <button className="btn btn-primary" onClick={handleSubmit} disabled={creating}>
        {creating ? 'Creating...' : 'Create'}
      </button>
    </div>
  )
}

export default function Credentials() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)

  const load = () => {
    setLoading(true)
    getCredentials()
      .then(res => {
        const list = Array.isArray(res) ? res : (res?.data ?? [])
        setItems(list)
        setError(null)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleDelete = async item => {
    if (!confirm('Delete this credential?')) return
    const schemaId = item.verifiablePresentation?.id ?? item.credential?.id
    try {
      await deleteCredential(schemaId)
      load()
    } catch (e) {
      alert(e.message)
    }
  }

  const allTypes = [...new Set(items.map(getCredentialType))]
  const grouped = allTypes.reduce((acc, t) => {
    acc[t] = items.filter(item => getCredentialType(item) === t)
    return acc
  }, {})

  if (loading) return <p className="loading">Loading...</p>
  if (error) return <p className="error-msg">{error}</p>

  return (
    <div>
      <CreateForm onCreate={load} />

      <h2 className="section-title">Credentials</h2>

      {items.length === 0 && <p className="empty-msg">No credentials found.</p>}

      {allTypes.map(type => (
        <div key={type} className="cred-group">
          <div className="cred-group-title">{type}</div>
          <div className="cred-cards">
            {grouped[type].map((item, i) => (
              <CredentialCard
                key={item.verifiablePresentation?.id ?? item.credential?.id ?? i}
                item={item}
                onEdit={setEditing}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </div>
      ))}

      {editing && (
        <EditModal
          item={editing}
          onSave={() => { setEditing(null); load() }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
