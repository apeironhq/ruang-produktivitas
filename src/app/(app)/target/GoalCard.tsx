import Link from 'next/link'
import { CalendarDays, Trophy } from 'lucide-react'
import { Badge, ProgressBar } from '@/components/ui/display'
import { formatDay, formatMetric, formatNumber } from '@/lib/format'
import { GOAL_STATUS, PROGRESS_SOURCE } from '@/lib/labels'
import type { GoalWithProgress } from '@/lib/types'

export function goalNumbers(g: GoalWithProgress) {
  if (g.progress_source !== 'manual') {
    const unit = g.progress_source === 'modul' ? 'modul' : 'tugas'
    return { current: `${g.itemDone} ${unit}`, target: `${g.itemTotal} ${unit}`, remaining: `${Math.max(0, g.itemTotal - g.itemDone)} ${unit}` }
  }
  const remaining = g.direction === 'turun' ? g.current - g.effTarget : g.effTarget - g.current
  return {
    current: formatMetric(g.current, g.metric_type, g.unit_label),
    target: formatMetric(g.effTarget, g.metric_type, g.unit_label),
    remaining: g.metric_type === 'biner' ? (g.current >= 1 ? '—' : 'Belum') : formatMetric(Math.max(0, remaining), g.metric_type, g.unit_label),
  }
}

export function GoalCard({ g }: { g: GoalWithProgress }) {
  const n = goalNumbers(g)
  const st = GOAL_STATUS[g.status]!
  return (
    <Link href={`/target/${g.id}`} className="card kpi clickable" aria-label={`${g.title}, progres ${formatNumber(g.percent)}%`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate">{g.title}</h3>
          <p className="item-sub mt-0.5 truncate">{g.category || PROGRESS_SOURCE[g.progress_source]!.label}</p>
        </div>
        {g.status === 'tercapai' ? <Badge tone={st.tone}><Trophy size={12} aria-hidden="true" />{st.label}</Badge> : <Badge tone={st.tone}>{st.label}</Badge>}
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="kpi-value text-[1.5rem]">{formatNumber(g.percent)}%</span>
          <span className="item-sub text-right">{n.current} <span className="text-[var(--text-faint)]">/ {n.target}</span></span>
        </div>
        <ProgressBar percent={g.percent} label={`Progres ${g.title}`} />
      </div>
      <div className="meta-row justify-between">
        <span>Sisa {n.remaining}</span>
        {g.due_date && <span><CalendarDays size={13} aria-hidden="true" />{formatDay(g.due_date)}</span>}
      </div>
    </Link>
  )
}
