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
      <div className="modal modal--json" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>JSON</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
        <pre className="json-pre">
          {json}
        </pre>
      </div>
    </div>
  )
}

function didToUrl(str) {
  if (str.startsWith('did:web:')) {
    const domain = decodeURIComponent(str.slice('did:web:'.length).split(':')[0])
    return `https://${domain}`
  }
  if (str.startsWith('did:webvh:')) {
    const parts = str.slice('did:webvh:'.length).split(':')
    if (parts.length < 2) return null
    const domain = decodeURIComponent(parts[1])
    return `https://${domain}`
  }
  return null
}

function LinkOrText({ text, style }) {
  if (typeof text !== 'string') return <span style={style}>{text}</span>
  const url = text.startsWith('http') ? text : didToUrl(text)
  if (url) {
    return <a href={url} target="_blank" rel="noopener noreferrer" className="subtle-link" style={{ wordBreak: 'break-all', ...style }}>{text}</a>
  }
  return <span style={style}>{text}</span>
}

function AttrValue({ value }) {
  const [imgFailed, setImgFailed] = useState(false)
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (typeof value !== 'string') return <span>{str}</span>
  const mightBeImage = value.startsWith('http') || value.startsWith('data:image/')
  if (!mightBeImage || imgFailed) return <LinkOrText text={value} />
  return (
    <img src={value} alt="" style={{ maxWidth: 120, maxHeight: 60, objectFit: 'contain', display: 'block' }} onError={() => setImgFailed(true)} />
  )
}

function CardSection({ label, children }) {
  return (
    <div className="cred-section">
      <div className="cred-section-label">{label}</div>
      {children}
    </div>
  )
}

function CredentialCard({ vc, type, onSelect }) {
  const subject = vc?.credentialSubject ?? {}
  const attrs = Object.entries(subject).filter(([k]) => k !== 'id')
  const schemaId = vc?.credentialSchema?.id ?? ''
  const issuer = typeof vc?.issuer === 'string' ? vc.issuer : (vc?.issuer?.id ?? '')
  const hasAttrs = subject.id || attrs.length > 0

  return (
    <div className="cred-card">
      <button className="cred-card-details-btn" onClick={onSelect} title="View details">{'{ }'}</button>
      {type && <div className="cred-card-type">{type}</div>}

      {schemaId && (
        <CardSection label="Schema">
          <div className="cred-field-value cred-field-mono">
            <LinkOrText text={schemaId} />
          </div>
        </CardSection>
      )}

      {issuer && (
        <CardSection label="Issuer">
          <div className="cred-field-value cred-field-mono">
            <LinkOrText text={issuer} />
          </div>
        </CardSection>
      )}

      {hasAttrs && (
        <CardSection label="Attributes">
          <div className="cred-card-attrs">
            <table>
              <tbody>
                {subject.id && (
                  <tr>
                    <td>id</td>
                    <td><LinkOrText text={subject.id} /></td>
                  </tr>
                )}
                {attrs.map(([key, value]) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td><AttrValue value={value} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardSection>
      )}
    </div>
  )
}

async function resolveCVpService(service) {
  try {
    const vp = await fetch(service.serviceEndpoint).then(r => r.ok ? r.json() : null)
    if (!vp) return { service, type: 'other', credentials: [], vp: null }
    const raw = vp.verifiableCredential
    const vcs = Array.isArray(raw) ? raw : (raw ? [raw] : [])
    const type = vcs.length > 0 ? await resolveVTCType({ credential: vcs[0] }) : 'other'
    return { service, type, credentials: vcs, vp }
  } catch {
    return { service, type: 'other', credentials: [], vp: null }
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

const TYPE_ORDER = ['ecs-org', 'ecs-persona', 'ecs-service', 'ecs-user-agent']
function typeRank(type) {
  const i = TYPE_ORDER.indexOf(type)
  return i === -1 ? Infinity : i
}

const POT_ROW_ORDER = ['ecs-service', 'ecs-org', 'ecs-persona', 'ecs-user-agent']
function potRowRank(type) {
  const i = POT_ROW_ORDER.indexOf(type)
  return i === -1 ? Infinity : i
}

const ECS_LABELS = {
  'ecs-service': 'Service credential',
  'ecs-org': 'Organization credential',
  'ecs-persona': 'Persona credential',
  'ecs-user-agent': 'User agent credential',
}

function credentialIssuer(vc) {
  return typeof vc?.issuer === 'string' ? vc.issuer : (vc?.issuer?.id ?? '')
}

function credentialDisplayName(vc, type) {
  if (ECS_LABELS[type]) return ECS_LABELS[type]
  const subjectName = vc?.credentialSubject?.name
  if (typeof subjectName === 'string' && subjectName) return subjectName
  const types = Array.isArray(vc?.type) ? vc.type.filter(t => t !== 'VerifiableCredential') : []
  return types[types.length - 1] ?? 'Credential'
}

/** ISO 3166-1 alpha-2 country code as an emoji flag (e.g. "CH"). */
function countryFlag(code) {
  if (typeof code !== 'string' || !/^[A-Za-z]{2}$/.test(code)) return null
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 127397 + c.charCodeAt(0)))
}

function CredentialSection({ title, items, renderItem }) {
  if (items.length === 0) return null
  const sorted = [...items].sort((a, b) => typeRank(a.type) - typeRank(b.type))
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 className="section-title">{title}</h2>
      <div className="cred-cards">
        {sorted.flatMap((item, i) => renderItem(item, i))}
      </div>
    </section>
  )
}

/* ─── Icons (stroke style shared with Header) ────────────────────────── */

function Icon({ children, size = 13 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  )
}

function ShieldIcon(props) {
  return (
    <Icon {...props}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </Icon>
  )
}

function FileTextIcon(props) {
  return (
    <Icon {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v5h5" />
    </Icon>
  )
}

function LockIcon(props) {
  return (
    <Icon {...props}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Icon>
  )
}

function BuildingIcon(props) {
  return (
    <Icon {...props}>
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4M10 10h4M10 14h4M10 18h4" />
    </Icon>
  )
}

function LayersIcon(props) {
  return (
    <Icon {...props}>
      <path d="m12.83 2.18 8.11 4.06c1.42.7 1.42 2.82 0 3.52l-8.11 4.06a1.87 1.87 0 0 1-1.66 0L3.06 9.76c-1.42-.7-1.42-2.82 0-3.52l8.11-4.06a1.87 1.87 0 0 1 1.66 0Z" />
      <path d="m22 12.5-9.17 4.59a1.87 1.87 0 0 1-1.66 0L2 12.5" />
    </Icon>
  )
}

/* ─── Service profile (shown when an ECS-Service credential is presented) ── */

function ServiceLogo({ uri, name }) {
  const [failed, setFailed] = useState(false)
  if (uri && !failed) {
    return <img className="svc-logo" src={uri} alt="" onError={() => setFailed(true)} />
  }
  return <div className="svc-logo svc-logo-fallback">{(name ?? '?').charAt(0).toUpperCase()}</div>
}

function ServiceHero({ subject }) {
  const age = Number(subject.minimumAgeRequired)
  return (
    <>
      <div className="svc-hero">
        <ServiceLogo uri={subject.logoUri} name={subject.name} />
        <div style={{ minWidth: 0 }}>
          <div className="svc-title-row">
            <h1 className="svc-name display">{subject.name ?? 'Unnamed service'}</h1>
            {subject.type && <span className="chip">{subject.type}</span>}
          </div>
          {subject.description && <p className="svc-desc">{subject.description}</p>}
        </div>
      </div>
      <div className="svc-meta">
        {Number.isFinite(age) && age > 0 && (
          <span className="meta-chip meta-chip-age">
            <b>{age}+</b> minimum age to connect
          </span>
        )}
        {subject.termsAndConditionsUri && (
          <a className="meta-chip" href={subject.termsAndConditionsUri} target="_blank" rel="noopener noreferrer">
            <FileTextIcon size={12} />
            Terms and conditions
          </a>
        )}
        {subject.privacyPolicyUri && (
          <a className="meta-chip" href={subject.privacyPolicyUri} target="_blank" rel="noopener noreferrer">
            <LockIcon size={12} />
            Privacy policy
          </a>
        )}
      </div>
    </>
  )
}

function ControllerLogo({ uri, name }) {
  const [failed, setFailed] = useState(false)
  if (uri && !failed) {
    return <img className="op-logo" src={uri} alt="" onError={() => setFailed(true)} />
  }
  return <div className="op-logo op-logo-fallback">{(name ?? '?').charAt(0).toUpperCase()}</div>
}

function ControllerCard({ item, onSelect }) {
  if (!item) return null
  const subject = item.credentials[0]?.credentialSubject ?? {}
  const isOrg = item.type === 'ecs-org'
  const flag = countryFlag(isOrg ? subject.countryCode : subject.controllerCountryCode)
  const idParts = [subject.registryId, subject.lei ? `LEI ${subject.lei}` : null].filter(Boolean)
  const detailParts = isOrg
    ? [subject.address, subject.organizationKind, subject.legalJurisdiction ? `Jurisdiction ${subject.legalJurisdiction}` : null]
    : [subject.description, subject.controllerJurisdiction ? `Jurisdiction ${subject.controllerJurisdiction}` : null]
  const details = detailParts.filter(Boolean).join(' · ')

  return (
    <div className="op-card">
      <button className="cred-card-details-btn" onClick={onSelect} title="View details">{'{ }'}</button>
      <p className="pot-label">
        <BuildingIcon size={11} />
        Operated by
      </p>
      <div className="op-head">
        <ControllerLogo uri={isOrg ? subject.logoUri : subject.avatarUri} name={subject.name} />
        <div style={{ minWidth: 0 }}>
          <div className="op-name">
            {flag && <span role="img" aria-label="Country flag" style={{ marginRight: 6 }}>{flag}</span>}
            {subject.name ?? (isOrg ? 'Unnamed organization' : 'Unnamed persona')}
          </div>
          {idParts.length > 0 && <div className="op-sub">{idParts.join(' · ')}</div>}
        </div>
      </div>
      {details && <p className="op-details">{details}</p>}
    </div>
  )
}

function TrustCard({ webDid, cvpItems, jscItems, onSelect }) {
  const rows = cvpItems
    .flatMap(item => item.credentials.map(vc => ({ item, vc })))
    .sort((a, b) => potRowRank(a.item.type) - potRowRank(b.item.type))

  return (
    <div className="pot-card">
      <div className="pot-band">
        <span className="pot-pill pot-pill-trust">
          <ShieldIcon size={12} />
          Proof of Trust
        </span>
        <span style={{ flex: 1 }} />
        <span className="pot-pill pot-pill-neutral">Self-declared</span>
      </div>
      <div className="pot-section">
        {webDid && <div className="pot-did"><LinkOrText text={webDid} /></div>}
        <p className="pot-note">
          Credentials presented by this service. They have not been verified against a Verana resolver from this page.
        </p>
      </div>
      {rows.length > 0 && (
        <div className="pot-section">
          <p className="pot-label">
            <LayersIcon size={11} />
            Credentials
          </p>
          {rows.map(({ item, vc }, i) => (
            <div className="pot-row" key={i}>
              <span className="pot-row-name">{credentialDisplayName(vc, item.type)}</span>
              <span className="pot-row-issuer">
                {credentialIssuer(vc) && <>issued by <LinkOrText text={credentialIssuer(vc)} /></>}
              </span>
              <button className="pot-row-btn" onClick={() => onSelect(item.vp ?? vc)} title="View details">{'{ }'}</button>
            </div>
          ))}
        </div>
      )}
      {jscItems.length > 0 && (
        <div className="pot-section">
          <p className="pot-label">
            <FileTextIcon size={11} />
            Schemas
          </p>
          {jscItems.map((item, i) => (
            <div className="pot-row" key={i}>
              <span className="pot-row-name">{ECS_LABELS[item.type] ? ECS_LABELS[item.type].replace(' credential', ' schema') : item.type}</span>
              <span className="pot-row-issuer">
                <LinkOrText text={item.service.serviceEndpoint} />
              </span>
              <button className="pot-row-btn" onClick={() => onSelect(item.service)} title="View details">{'{ }'}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ConnectCard({ webDid, endpoints }) {
  return (
    <aside className="connect-card">
      <div className="qr-desktop">
        <span className="qr-tile qr-tile-sm">
          <img src={qrUrl} alt="Invitation QR" />
        </span>
        <p className="qr-label">Scan to connect</p>
      </div>
      <div className="qr-mobile">
        <a href="/invitation" className="btn btn-primary">Connect</a>
      </div>
      {webDid && <div className="connect-did">{webDid}</div>}
      {endpoints.length > 0 && <div className="connect-endpoints">{endpoints.join(', ')}</div>}
    </aside>
  )
}

function ServiceProfile({ serviceItem, cvpItems, jscItems, webDid, endpoints, onSelect }) {
  const subject = serviceItem.credentials[0]?.credentialSubject ?? {}
  const controllerItem =
    cvpItems.find(i => i.type === 'ecs-org' && i.credentials.length > 0) ??
    cvpItems.find(i => i.type === 'ecs-persona' && i.credentials.length > 0)

  useEffect(() => {
    if (typeof subject.name === 'string' && subject.name) document.title = subject.name
  }, [subject.name])

  return (
    <div className="profile">
      <ServiceHero subject={subject} />
      <div className="profile-grid">
        <div className="profile-main">
          <ControllerCard item={controllerItem} onSelect={() => onSelect(controllerItem?.vp)} />
          <TrustCard webDid={webDid} cvpItems={cvpItems} jscItems={jscItems} onSelect={onSelect} />
        </div>
        <ConnectCard webDid={webDid} endpoints={endpoints} />
      </div>
    </div>
  )
}

/* ─── Classic view (no ECS-Service credential presented) ─────────────── */

function ClassicView({ agentConfig, webDid, endpoints, cvpItems, jscItems, credsLoading, onSelect }) {
  const noCredentials = !credsLoading && cvpItems.length === 0 && jscItems.length === 0

  return (
    <div>
      {agentConfig.welcomeMessage && (
        <h1 className="welcome display">
          {agentConfig.welcomeMessage}
        </h1>
      )}

      <section style={{ marginBottom: 32 }}>
        <h2 className="section-title">
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
              {webDid ? <LinkOrText text={webDid} /> : <span className="text-subtle">Not assigned</span>}
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

          <div className="qr-desktop">
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 24 }}>
              <div style={{ textAlign: 'center' }}>
                <span className="qr-tile">
                  <img src={qrUrl} alt="Invitation QR" />
                </span>
                <p className="qr-label">Scan to connect</p>
              </div>
            </div>
          </div>

          <div className="qr-mobile" style={{ paddingTop: 16, textAlign: 'center' }}>
            <a href="/invitation" className="btn btn-primary">Connect</a>
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
            <CredentialCard key={`${i}-${j}`} vc={vc} type={item.type} onSelect={() => onSelect(item.vp)} />
          ))
        }
      />

      <CredentialSection
        title="Schema Credentials"
        items={jscItems}
        renderItem={(item, i) => (
          <div key={i} className="cred-card">
            <button className="cred-card-details-btn" onClick={() => onSelect(item.service)} title="View details">{'{ }'}</button>
            <div className="cred-card-type">{item.type}</div>
            <div className="cred-field-value cred-field-mono text-subtle">
              <LinkOrText text={item.service.serviceEndpoint} />
            </div>
          </div>
        )}
      />
    </div>
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

        Promise.all([
          Promise.all(cvp.map(resolveCVpService)).then(setCvpItems),
          Promise.all(jsc.map(resolveJscVpService)).then(setJscItems),
        ]).finally(() => setCredsLoading(false))
      })
      .catch(err => setError(err.message))
  }, [])

  if (error) return <p className="error-msg">{error}</p>
  if (!doc || credsLoading) return <p className="loading">Loading...</p>

  const endpoints = (doc.service ?? [])
    .filter(s => s.type === 'did-communication')
    .map(s => s.serviceEndpoint)
  const webDid = (doc.alsoKnownAs ?? []).find(d => d.startsWith('did:webvh:')) ?? doc.id

  const serviceItem = cvpItems.find(i => i.type === 'ecs-service' && i.credentials.length > 0)

  return (
    <div>
      {selected && <JsonModal data={selected} onClose={() => setSelected(null)} />}

      {serviceItem ? (
        <ServiceProfile
          serviceItem={serviceItem}
          cvpItems={cvpItems}
          jscItems={jscItems}
          webDid={webDid}
          endpoints={endpoints}
          onSelect={setSelected}
        />
      ) : (
        <ClassicView
          agentConfig={agentConfig}
          webDid={webDid}
          endpoints={endpoints}
          cvpItems={cvpItems}
          jscItems={jscItems}
          credsLoading={false}
          onSelect={setSelected}
        />
      )}
    </div>
  )
}
