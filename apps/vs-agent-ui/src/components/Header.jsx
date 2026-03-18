export default function Header({ title, onMenuToggle }) {

  return (
    <header className="header">
      <div className="header-logo">
        <div className="header-logo-icon">V</div>
        <span className="header-logo-name">Verana</span>
      </div>
      <div className="header-center">
        <h1>{title}</h1>
      </div>
      {/* Mobile: hamburger */}
      <button className="hamburger" onClick={onMenuToggle} aria-label="Toggle menu">
        <span />
        <span />
        <span />
      </button>
    </header>
  )
}
