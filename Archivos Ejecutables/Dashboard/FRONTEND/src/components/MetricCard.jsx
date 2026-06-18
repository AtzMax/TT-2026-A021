export default function MetricCard({ title, subtitle, value, unit, color, badge, icon, onClick }) {
  return (
    <div className="card" onClick={onClick}>
      <div className="card-content">
        <div className="card-title">{title}</div>
        <div className="card-subtitle">{subtitle}</div>
        <div className="card-value" style={{ color }}>
          {value}
          {unit && (
            <span className="card-unit" style={{ color }}>
              {unit}
            </span>
          )}
        </div>
        <div
          className="card-badge"
          style={{ background: `${color}22`, color }}
        >
          {badge}
        </div>
      </div>
      <div className="card-emoji">{icon}</div>
    </div>
  )
}
