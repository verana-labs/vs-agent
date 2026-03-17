import { qrUrl } from '../api'

export default function QRSection() {
  return (
    <div className="qr-section">
      <div className="qr-card">
        <img src={qrUrl} alt="QR Code" />
        <p className="qr-label">Scan to connect</p>
      </div>
    </div>
  )
}
