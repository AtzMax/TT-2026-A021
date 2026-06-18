import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Leaf, Bot, Video, BarChart2 } from 'lucide-react'

const pages = [
  { id: 'dashboard', label: 'Dashboard', Icon: Leaf },
  { id: 'modelo',    label: 'Modelo',    Icon: Bot },
  { id: 'camara',    label: 'Cámara Isla', Icon: Video },
  { id: 'historico', label: 'Dashboard Histórico', Icon: BarChart2 },
]

const EXPANDED_W  = 200
const COLLAPSED_W = 68

export default function Sidebar({ currentPage, onNavigate }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <motion.aside
      className="sidebar"
      animate={{ width: expanded ? EXPANDED_W : COLLAPSED_W }}
      transition={{ type: 'spring', stiffness: 280, damping: 28 }}
    >
      <button
        className="sidebar-toggle"
        onClick={() => setExpanded(v => !v)}
        title={expanded ? 'Colapsar' : 'Expandir'}
      >
        <motion.span
          className="sidebar-toggle-icon"
          animate={{ rotate: expanded ? 0 : 180 }}
          transition={{ duration: 0.25 }}
        >
          ‹
        </motion.span>
      </button>

      <nav className="sidebar-nav">
        {pages.map(p => {
          const active = currentPage === p.id
          return (
            <div key={p.id}>
              <button
                className={`sidebar-item${active ? ' sidebar-item-active' : ''}`}
                onClick={() => onNavigate(p.id)}
                title={!expanded ? p.label : undefined}
              >
                {active && (
                  <motion.div
                    className="sidebar-item-bg"
                    layoutId="sidebar-active-bg"
                    transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                  />
                )}
                <span className="sidebar-item-icon"><p.Icon size={20} /></span>
                <AnimatePresence>
                  {expanded && (
                    <motion.span
                      className="sidebar-item-label"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      transition={{ duration: 0.18 }}
                    >
                      {p.label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>

              {p.children && p.children.map(child => {
                const childActive = currentPage === child.id
                return (
                  <button
                    key={child.id}
                    className={`sidebar-item sidebar-item-child${childActive ? ' sidebar-item-active' : ''}`}
                    onClick={() => onNavigate(child.id)}
                    title={!expanded ? child.label : undefined}
                  >
                    {childActive && (
                      <motion.div
                        className="sidebar-item-bg"
                        layoutId="sidebar-active-bg"
                        transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                      />
                    )}
                    <span className="sidebar-item-icon"><child.Icon size={20} /></span>
                    <AnimatePresence>
                      {expanded && (
                        <motion.span
                          className="sidebar-item-label"
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -8 }}
                          transition={{ duration: 0.18 }}
                        >
                          {child.label}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </button>
                )
              })}
            </div>
          )
        })}
      </nav>
    </motion.aside>
  )
}
