export default function Sidebar({ current, onNavigate, open }) {
  const items = [
    { key: 'dashboard', label: 'Dashboard', icon: '◈' },
    { key: 'credentials', label: 'Credentials', icon: '◉' },
  ]

  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <ul className="sidebar-nav">
        {items.map(item => (
          <li key={item.key}>
            <button
              className={current === item.key ? 'active' : ''}
              onClick={() => onNavigate(item.key)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
