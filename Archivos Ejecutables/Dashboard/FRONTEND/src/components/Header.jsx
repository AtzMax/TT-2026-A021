import { Leaf, Radio, RefreshCw, Sun, Moon, Bell } from 'lucide-react'

function formatTs(isoStr) {
  if (!isoStr) return '--'
  const iso = isoStr.replace(' ', 'T')
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '--'
  const dd   = String(d.getDate()).padStart(2, '0')
  const mm   = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh   = String(d.getHours()).padStart(2, '0')
  const min  = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`
}

export default function Header({ lastTs, theme, onToggleTheme, onReload, reloading, unreadCount, onOpenNotifications }) {
  return (
    <div className="header">
      <div className="header-brand">
        <div className="header-icon"><Leaf size={28} /></div>
        <div>
          <div className="header-title">Estado del Ambiente</div>
          <div className="header-subtitle"><Radio size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />Monitoreo en Tiempo Real</div>
        </div>
      </div>

      <div className="header-controls">
        <button
          className="ctrl-btn"
          onClick={onReload}
          disabled={reloading}
          title="Recargar datos"
        >
          <span className={`btn-icon${reloading ? ' spinning' : ''}`}><RefreshCw size={18} /></span>
        </button>

        <button
          className="ctrl-btn"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
        >
          <span className="btn-icon">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</span>
        </button>

        <button
          className="ctrl-btn"
          onClick={onOpenNotifications}
          title="Notificaciones"
        >
          <span className="btn-icon"><Bell size={18} /></span>
          {unreadCount > 0 && (
            <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
          )}
        </button>
      </div>

      <div className="header-time">
        <span className="header-time-label">{lastTs ? 'En vivo ●' : 'Última lectura'}</span>
        <span className="header-time-value">{formatTs(lastTs)}</span>
      </div>
    </div>
  )
}
