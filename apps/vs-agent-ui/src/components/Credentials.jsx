import { useState, useEffect } from 'react'
import { getCredentials, updateCredential, deleteCredential } from '../api'

const TYPES = ['organization', 'service', 'persona', 'userAgent']

function CredentialCard({ cred, onEdit, onDelete }) {
  const attrs = Object.entries(cred).filter(
    ([k]) => k !== 'type' && k !== 'id' && k !== 'credentialId',
  )

  return (
    <div className="cred-card">
      <div className="cred-card-attrs">
        <table>
          <tbody>
            {attrs.map(([key, value]) => (
              <tr key={key}>
                <td>{key}</td>
                <td>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cred-card-actions">
        <button className="btn btn-edit" onClick={() => onEdit(cred)}>Edit</button>
        <button className="btn btn-delete" onClick={() => onDelete(cred)}>Delete</button>
      </div>
    </div>
  )
}

function EditModal({ cred, onSave, onClose }) {
  const [value, setValue] = useState(JSON.stringify(cred, null, 2))
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    try {
      const parsed = JSON.parse(value)
      setSaving(true)
      await updateCredential(parsed)
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
      const parsed = JSON.parse(json)
      setCreating(true)
      await updateCredential({ ...parsed, type })
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
        <label>Attributes (JSON)</label>
        <textarea value={json} onChange={e => setJson(e.target.value)} />
      </div>
      <button className="btn btn-primary" onClick={handleSubmit} disabled={creating}>
        {creating ? 'Creating...' : 'Create'}
      </button>
    </div>
  )
}

export default function Credentials() {
  const [credentials, setCredentials] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)

  const load = () => {
    setLoading(true)
    getCredentials()
      .then(data => {
        setCredentials(Array.isArray(data) ? data : data?.credentials ?? [])
        setError(null)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleDelete = async cred => {
    if (!confirm('Delete this credential?')) return
    try {
      await deleteCredential(cred.id ?? cred.credentialId)
      load()
    } catch (e) {
      alert(e.message)
    }
  }

  const grouped = TYPES.reduce((acc, type) => {
    acc[type] = credentials.filter(c => c.type === type)
    return acc
  }, {})

  const hasAny = credentials.length > 0

  if (loading) return <p className="loading">Loading...</p>
  if (error) return <p className="error-msg">{error}</p>

  return (
    <div>
      <CreateForm onCreate={load} />

      <h2 className="section-title">Credentials</h2>

      {!hasAny && <p className="empty-msg">No credentials found.</p>}

      {TYPES.map(type => {
        const items = grouped[type]
        if (items.length === 0) return null
        return (
          <div key={type} className="cred-group">
            <div className="cred-group-title">{type}</div>
            <div className="cred-cards">
              {items.map((cred, i) => (
                <CredentialCard
                  key={cred.id ?? cred.credentialId ?? i}
                  cred={cred}
                  onEdit={setEditing}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </div>
        )
      })}

      {editing && (
        <EditModal
          cred={editing}
          onSave={() => { setEditing(null); load() }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
