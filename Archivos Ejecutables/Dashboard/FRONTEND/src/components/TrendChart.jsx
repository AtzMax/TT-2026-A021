import { useEffect, useRef } from 'react'
import { Chart, registerables } from 'chart.js'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import { TrendingUp } from 'lucide-react'

Chart.register(...registerables, ChartDataLabels)

export default function TrendChart({ history, theme }) {
  const canvasRef = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d')
    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'AQI',
            data: [],
            borderColor: '#2D62ED',
            backgroundColor: 'rgba(45,98,237,0.07)',
            tension: 0.4,
            pointRadius: 3,
            pointBackgroundColor: '#2D62ED',
            borderWidth: 2.5,
            fill: true,
          },
          {
            label: 'PM2.5',
            data: [],
            borderColor: '#00C853',
            backgroundColor: 'rgba(0,230,118,0.05)',
            tension: 0.4,
            pointRadius: 2,
            pointBackgroundColor: '#00C853',
            borderWidth: 2,
            fill: true,
          },
          {
            label: 'PM10',
            data: [],
            borderColor: '#FF9800',
            backgroundColor: 'rgba(255,152,0,0.05)',
            tension: 0.4,
            pointRadius: 2,
            pointBackgroundColor: '#FF9800',
            borderWidth: 2,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        clip: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(255,255,255,0.95)',
            titleColor: '#2D3436',
            bodyColor: '#4b5357',
            borderColor: '#F1F2F6',
            borderWidth: 1,
            padding: 12,
            titleFont: { family: "'DM Sans'", weight: '700' },
            bodyFont: { family: "'DM Sans'" },
          },
          datalabels: {
            display: (ctx) => ctx.dataIndex % 5 === 0,
            anchor: 'end',
            align: 'top',
            offset: 2,
            formatter: (v) => Math.round(v),
            font: { family: "'DM Mono'", size: 9 },
            color: (ctx) => ['#2D62ED', '#00C853', '#FF9800'][ctx.datasetIndex],
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: { font: { family: "'DM Mono'", size: 10 }, color: '#B2BEC3', maxTicksLimit: 8 },
            border: { display: false },
          },
          y: {
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: { font: { family: "'DM Mono'", size: 10 }, color: '#B2BEC3' },
            border: { display: false },
          },
        },
      },
    })
    return () => {
      chartRef.current?.destroy()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Update chart colors when theme changes
  useEffect(() => {
    if (!chartRef.current) return
    const gridColor = theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'
    const tickColor = theme === 'dark' ? '#8B949E' : '#B2BEC3'
    chartRef.current.options.scales.x.grid.color = gridColor
    chartRef.current.options.scales.y.grid.color = gridColor
    chartRef.current.options.scales.x.ticks.color = tickColor
    chartRef.current.options.scales.y.ticks.color = tickColor
    chartRef.current.update()
  }, [theme])

  // Update chart data when history changes
  useEffect(() => {
    if (!chartRef.current) return
    chartRef.current.data.labels = history.labels
    chartRef.current.data.datasets[0].data = history.aqi
    chartRef.current.data.datasets[1].data = history.pm25
    chartRef.current.data.datasets[2].data = history.pm10
    chartRef.current.update('none')
  }, [history])

  return (
    <div className="chart-section">
      <div className="chart-header">
        <div className="chart-title"><TrendingUp size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Tendencia · Últimas mediciones</div>
        <div className="chart-legend">
          <div className="legend-item">
            <div className="legend-dot" style={{ background: '#2D62ED' }} />
            AQI
          </div>
          <div className="legend-item">
            <div className="legend-dot" style={{ background: '#00E676' }} />
            PM 2.5
          </div>
          <div className="legend-item">
            <div className="legend-dot" style={{ background: '#FF9800' }} />
            PM 10
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} height={180} />
    </div>
  )
}

