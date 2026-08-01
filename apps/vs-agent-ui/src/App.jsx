import Header from './components/Header'
import Dashboard from './components/Dashboard'
import Footer from './components/Footer'
export default function App() {
  return (
    <div className="layout">
      <Header />
      <div className="content">
        <Dashboard />
      </div>
      <Footer />
    </div>
  )
}
