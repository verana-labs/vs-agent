import Header from './components/Header'
import Dashboard from './components/Dashboard'
import Footer from './components/Footer'
export default function App() {
  return (
    <div className="layout">
      <Header />
      <div className="notice-band">
        This page is the placeholder of your Verana business wallet.
      </div>
      <div className="content">
        <Dashboard />
      </div>
      <Footer />
    </div>
  )
}
