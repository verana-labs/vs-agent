import { useState } from 'react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import Dashboard from './components/Dashboard'
export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="layout">
      <Header
        title="Dashboard"
        onMenuToggle={() => setSidebarOpen(o => !o)}
      />
      <div className="body">
        {sidebarOpen && (
          <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
        )}
        <Sidebar
          current="dashboard"
          onNavigate={() => setSidebarOpen(false)}
          open={sidebarOpen}
        />
        <div className="content">
          <Dashboard />
        </div>
      </div>
    </div>
  )
}
