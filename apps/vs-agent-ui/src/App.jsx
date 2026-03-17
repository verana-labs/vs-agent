import { useState } from 'react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import Dashboard from './components/Dashboard'
import Credentials from './components/Credentials'
import QRSection from './components/QRSection'

export default function App() {
  const [view, setView] = useState('dashboard')

  const titles = {
    dashboard: 'Dashboard',
    credentials: 'Credentials',
    qr: 'Scan QR',
  }

  return (
    <div className="layout">
      <Header title={titles[view]} />
      <div className="body">
        <Sidebar current={view} onNavigate={setView} />
        <div className="content">
          {view === 'dashboard' && <Dashboard />}
          {view === 'credentials' && <Credentials />}
          {view === 'qr' && <QRSection />}
        </div>
      </div>
    </div>
  )
}
