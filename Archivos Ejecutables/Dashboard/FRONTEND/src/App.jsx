import { useState, useEffect, useCallback } from 'react'
import { useAirQuality } from './hooks/useAirQuality'
import { useCameraStatus } from './hooks/useCameraStatus'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import NotificationsPanel from './components/NotificationsPanel'
import DashboardHistorico from './pages/DashboardHistorico'
import Modelo from './pages/Modelo'
import DashboardCalidadAire from './pages/DashboardCalidadAire'
import CamaraIsla from './components/CamaraIsla'


export default function App() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme') || 'light'
    document.documentElement.setAttribute('data-theme', saved)
    return saved
  })
  const [showNotifs, setShowNotifs] = useState(false)
  const [currentPage, setCurrentPage] = useState('dashboard')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'light' ? 'dark' : 'light'
      localStorage.setItem('theme', next)
      return next
    })
  }, [])

  const {
    data,
    history,
    lastTs,
    reloading,
    notifications,
    reload,
    markAllRead,
    clearAll,
  } = useAirQuality()

  const { cameraOnline, detecciones } = useCameraStatus()

  const unreadCount = notifications.filter((n) => !n.read).length

  const handleBellClick = useCallback(() => {
    setShowNotifs(true)
    markAllRead()
  }, [markAllRead])

  return (
    <div className="app-layout">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <div className="dashboard">
      <Header
        lastTs={lastTs}
        theme={theme}
        onToggleTheme={toggleTheme}
        onReload={reload}
        reloading={reloading}
        unreadCount={unreadCount}
        onOpenNotifications={handleBellClick}
      />

      {currentPage === 'modelo' && <Modelo theme={theme} />}

      {currentPage === 'camara' && <CamaraIsla />}

      {currentPage === 'historico' && <DashboardHistorico theme={theme} />}

      {currentPage === 'dashboard' && (
        <DashboardCalidadAire data={data} history={history} theme={theme} cameraOnline={cameraOnline} detecciones={detecciones} />
      )}

      {showNotifs && (
        <NotificationsPanel
          notifications={notifications}
          onClose={() => setShowNotifs(false)}
          onMarkRead={markAllRead}
          onClear={clearAll}
        />
      )}
    </div>
    </div>
  )
}
