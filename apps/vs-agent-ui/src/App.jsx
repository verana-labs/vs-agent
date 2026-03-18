import { useState } from 'react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import Dashboard from './components/Dashboard'
import Credentials from './components/Credentials'
export default function App() {
  const [view, setView] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const titles = {
    dashboard: 'Dashboard',
    credentials: 'Credentials',
  }

  const handleNavigate = (key) => {
    setView(key)
    setSidebarOpen(false)
  }

  return (
    <div className="layout">
      <Header
        title={titles[view]}
        onMenuToggle={() => setSidebarOpen(o => !o)}
      />
      <div className="body">
        {sidebarOpen && (
          <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
        )}
        <Sidebar
          current={view}
          onNavigate={handleNavigate}
          open={sidebarOpen}
        />
        <div className="content">
          {view === 'dashboard' && <Dashboard />}
          {view === 'credentials' && <Credentials />}
        </div>
      </div>
    </div>
  )
}
