import { useEffect } from 'react'
import { Bell, Leaf, Wind, Cloud, CheckCircle } from 'lucide-react'

const ICON_MAP = {
  leaf:  <Leaf  size={18} />,
  wind:  <Wind  size={18} />,
  cloud: <Cloud size={18} />,
}

function timeAgo(date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 60) return `hace ${diff}s`
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`
  return `hace ${Math.floor(diff / 86400)}d`
}

export default function NotificationsPanel({ notifications, onClose, onMarkRead, onClear }) {
  const unread = notifications.filter((n) => !n.read).length

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="notif-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="notif-panel">
        <div className="notif-panel-header">
          <div>
            <div className="notif-panel-title">
              <Bell size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Notificaciones
            </div>
            {unread > 0 && (
              <div className="notif-unread-count">{unread} sin leer</div>
            )}
          </div>
          <div className="notif-actions">
            {unread > 0 && (
              <button className="notif-action-btn" onClick={onMarkRead}>
                Marcar leídas
              </button>
            )}
            {notifications.length > 0 && (
              <button className="notif-action-btn danger" onClick={onClear}>
                Limpiar todo
              </button>
            )}
            <button className="modal-close" style={{ position: 'static', width: 32, height: 32 }} onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        <div className="notif-list">
          {notifications.length === 0 ? (
            <div className="notif-empty">
              <div className="notif-empty-icon"><CheckCircle size={36} /></div>
              <div className="notif-empty-title">Todo en orden</div>
              <div className="notif-empty-sub">No hay alertas activas</div>
            </div>
          ) : (
            notifications.map((n) => (
              <div key={n.id} className={`notif-item ${n.type}${n.read ? ' read' : ''}`}>
                <div className="notif-item-icon">{ICON_MAP[n.icon] ?? <Bell size={18} />}</div>
                <div className="notif-item-content">
                  <div className="notif-item-title">{n.title}</div>
                  <div className="notif-item-msg">{n.message}</div>
                  <div className="notif-item-time">{timeAgo(n.time)}</div>
                </div>
                {!n.read && <div className="notif-dot" />}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
