import Header from './components/Header'
import Dashboard from './components/Dashboard'
import Footer from './components/Footer'
import { getAgentConfig } from './api'
export default function App() {
  const { showPlaceholderMessage } = getAgentConfig()
  return (
    <div className="layout">
      <Header />
      {showPlaceholderMessage !== false && (
        <div className="notice-band">
          This page is the placeholder of your Verana business wallet.
        </div>
      )}
      <div className="content">
        <Dashboard />
      </div>
      <Footer />
    </div>
  )
}
