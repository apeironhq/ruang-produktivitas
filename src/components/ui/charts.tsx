'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { formatNumber } from '@/lib/format'

/** Sparkline: garis 2px + area 10%, titik akhir r=3 dengan cincin permukaan. Dekoratif. Lebar mengikuti wadah. */
export function Sparkline({ values, color, height = 40 }: { values: number[]; color: string; height?: number }) {
  const wrap = useRef<HTMLDivElement | null>(null)
  const [w, setW] = useState(112)
  useEffect(() => {
    if (!wrap.current) return
    const ro = new ResizeObserver(([e]) => { if (e && e.contentRect.width > 0) setW(Math.round(e.contentRect.width)) })
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [])
  const pad = 4
  const v = values.length ? values : [0, 0]
  const max = Math.max(...v, 1)
  const step = (w - pad * 2) / Math.max(v.length - 1, 1)
  const pts = v.map((n, i) => [pad + i * step, height - pad - (n / max) * (height - pad * 2)] as const)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const area = `${line} L${pts[pts.length - 1]![0].toFixed(1)} ${height - pad} L${pts[0]![0].toFixed(1)} ${height - pad} Z`
  const last = pts[pts.length - 1]!
  return (
    <div ref={wrap} className="spark-wrap kpi-spark">
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden="true" className="spark">
        <path d={area} fill={color} fillOpacity={0.1} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={last[0]} cy={last[1]} r={3} fill={color} stroke="var(--bg-surface)" strokeWidth={2} />
      </svg>
    </div>
  )
}

interface Point { date: string; value: number; extra?: string }

/** Grafik garis+area satu seri; hover/keyboard menampilkan tooltip; tabel tersembunyi untuk pembaca layar. */
export function TrendChart({ points, color = 'var(--p-blue)', label, unit = '', height = 220 }: { points: Point[]; color?: string; label: string; unit?: string; height?: number }) {
  const wrap = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(600)
  const [active, setActive] = useState<number | null>(null)
  useEffect(() => {
    if (!wrap.current) return
    setWidth(wrap.current.clientWidth || 600)
    const ro = new ResizeObserver(([e]) => { if (e) setWidth(Math.max(240, e.contentRect.width)) })
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [])
  const m = { top: 12, right: 12, bottom: 28, left: 36 }
  const innerW = width - m.left - m.right
  const innerH = height - m.top - m.bottom
  const niceMax = useMemo(() => {
    const max = Math.max(...points.map((p) => p.value), 0)
    if (max <= 4) return 4
    const mag = 10 ** Math.floor(Math.log10(max))
    const n = max / mag
    return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
  }, [points])
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * niceMax)).filter((v, i, a) => a.indexOf(v) === i)
  const x = (i: number) => m.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
  const y = (v: number) => m.top + innerH - (v / niceMax) * innerH
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ')
  const area = points.length ? `${line} L${x(points.length - 1).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z` : ''
  const fmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const dateLabel = (d: string) => fmt.format(new Date(`${d}T00:00:00Z`))
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 64))))

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left - m.left
    const i = Math.round((px / Math.max(innerW, 1)) * (points.length - 1))
    setActive(Math.min(points.length - 1, Math.max(0, i)))
  }
  function onKey(e: React.KeyboardEvent) {
    if (!points.length) return
    if (e.key === 'ArrowRight') setActive((a) => Math.min(points.length - 1, (a ?? -1) + 1))
    else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? points.length) - 1))
    else return
    e.preventDefault()
  }
  const tip = active === null || !points[active] ? null : {
    p: points[active], left: Math.min(Math.max(x(active), 70), width - 70), top: y(points[active].value),
  }

  return (
    <div ref={wrap} className="trend">
      <svg width={width} height={height} role="img" tabIndex={0}
        aria-label={`${label}: grafik ${points.length} hari. Gunakan panah kiri/kanan untuk melihat nilai.`}
        onMouseMove={onMove} onMouseLeave={() => setActive(null)} onKeyDown={onKey} onBlur={() => setActive(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={m.left - 8} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">{t}</text>
          </g>
        ))}
        {points.map((p, i) => (i % labelEvery === 0 || i === points.length - 1) ? (
          <text key={p.date} x={x(i)} y={height - 8} className="axis" textAnchor="middle">{dateLabel(p.date)}</text>
        ) : null)}
        <path d={area} fill={color} fillOpacity={0.1} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.length <= 14 && points.map((p, i) => (
          <circle key={`d${i}`} cx={x(i)} cy={y(p.value)} r={3.5} fill={color} stroke="var(--bg-surface)" strokeWidth={2} />
        ))}
        {tip && active !== null && (
          <g>
            <line x1={x(active)} x2={x(active)} y1={m.top} y2={m.top + innerH} className="cross" />
            <circle cx={x(active)} cy={tip.top} r={5} fill={color} stroke="var(--bg-surface)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {tip && (
        <div className="tip" style={{ left: tip.left, top: Math.max(tip.top - 12, 0) }} role="status">
          <strong>{formatNumber(tip.p.value)}</strong> {unit || label.toLowerCase()}
          <span className="tip-date">{dateLabel(tip.p.date)}{tip.p.extra ? ` · ${tip.p.extra}` : ''}</span>
        </div>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead><tr><th scope="col">Tanggal</th><th scope="col">Nilai</th></tr></thead>
        <tbody>{points.map((p) => <tr key={`t${p.date}`}><td>{dateLabel(p.date)}</td><td>{p.value}</td></tr>)}</tbody>
      </table>
    </div>
  )
}
