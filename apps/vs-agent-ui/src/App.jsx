import Header from './components/Header'
import Dashboard from './components/Dashboard'
export default function App() {
  return (
    <div className="layout">
      <Header />
      <div className="content">
        <Dashboard />
      </div>
    </div>
  )
}
