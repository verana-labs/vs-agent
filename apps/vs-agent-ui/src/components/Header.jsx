import logoSvg from '../assets/logo.svg'

export default function Header() {
  return (
    <header className="header">
      <div className="header-logo">
        <img src={logoSvg} alt="Verana" className="header-logo-icon" />
        <span className="header-logo-name">Verana</span>
      </div>
    </header>
  )
}
