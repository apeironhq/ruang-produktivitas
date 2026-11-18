import 'server-only'
import { goalNumbers } from '../../app/(app)/target/GoalCard'
import { addDays, startOfDayIso, todayIn } from '../dates'
import { formatRupiah, formatShort, formatTime } from '../format'
import { loadGoals, todayAgenda } from './panels'
import { OPEN, longDay, type Ctx } from './ui'

/*
 * Ringkasan data pengguna untuk Rupi AI (hanya bila pengguna mengizinkan di Pengaturan).
 * Teks biasa yang ringkas — dikirim ke penyedia AI pilihan pengguna bersama pesannya.
 */

const MAX_CHARS = 3500
const clip = (s: string | null | undefined, n = 60) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export async function dataSnapshot(ctx: Ctx): Promise<string> {
  const today = todayIn(ctx.tz)
  const tomorrow = startOfDayIso(addDays(today, 1), ctx.tz)
  const in4 = startOfDayIso(addDays(today, 4), ctx.tz)
  const monthStart = `${today.slice(0, 7)}-01`
  const nowIso = new Date().toISOString()
  const [agenda, soonTasks, soonEvents, openCount, goals, tx, accts, bal, habits, checks, timers] = await Promise.all([
    todayAgenda(ctx),
    ctx.db.from('tasks').select('title, due_at').eq('user_id', ctx.userId).eq('kind', 'tugas').in('status', OPEN)
      .gte('due_at', tomorrow).lt('due_at', in4).order('due_at').limit(8),
    ctx.db.from('tasks').select('title, start_at, location').eq('user_id', ctx.userId).eq('kind', 'kegiatan').neq('status', 'dibatalkan')
      .gte('start_at', tomorrow).lt('start_at', in4).order('start_at').limit(8),
    ctx.db.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).eq('kind', 'tugas').in('status', OPEN),
    loadGoals(ctx).catch(() => []),
    ctx.db.from('transactions').select('type, amount, occurred_on').eq('user_id', ctx.userId).in('type', ['pemasukan', 'pengeluaran']).gte('occurred_on', monthStart).limit(5000),
    ctx.db.from('financial_accounts').select('id').eq('user_id', ctx.userId).eq('is_archived', false),
    ctx.db.from('account_balances').select('account_id, balance').eq('user_id', ctx.userId),
    ctx.db.from('habits').select('id, name').eq('user_id', ctx.userId).eq('is_archived', false).eq('frequency', 'harian').limit(20),
    ctx.db.from('habit_checkins').select('habit_id').eq('user_id', ctx.userId).eq('checkin_date', today).limit(200),
    ctx.db.from('bot_timers').select('kind, label, fire_at').eq('user_id', ctx.userId).is('sent_at', null).gte('fire_at', nowIso).order('fire_at').limit(6),
  ])

  const out: string[] = []
  const time = (iso: string) => formatTime(iso, ctx.tz)
  const when = (iso: string) => formatShort(iso, ctx.tz)

  // Agenda hari ini
  const todayItems = [
    ...agenda.events.map((e) => ({ at: e.start_at!, line: `${time(e.start_at!)} Kegiatan: ${clip(e.title)}${e.location ? ` (di ${clip(e.location, 30)})` : ''}` })),
    ...agenda.dueToday.map((t) => {
      const at = (t.due_at ?? t.start_at)!
      return { at, line: `${time(at)} Tugas: ${clip(t.title)}${new Date(at).getTime() < Date.now() ? ' (tenggat sudah lewat)' : ''}` }
    }),
  ].sort((a, b) => a.at.localeCompare(b.at))
  out.push(`Agenda hari ini (${longDay(today)}):`, ...(todayItems.length ? todayItems.map((i) => `- ${i.line}`) : ['- kosong']))

  if (agenda.overdue.length) {
    out.push(`Tugas terlambat (${agenda.overdue.length}${agenda.overdue.length >= 10 ? '+' : ''}):`, ...agenda.overdue.slice(0, 8).map((t) => `- ${clip(t.title)} (tenggat ${when(t.due_at!)})`))
  }

  const soon = [
    ...(soonEvents.data ?? []).map((e) => ({ at: e.start_at as string, line: `${when(e.start_at as string)} Kegiatan: ${clip(e.title)}${e.location ? ` (di ${clip(e.location, 30)})` : ''}` })),
    ...(soonTasks.data ?? []).map((t) => ({ at: t.due_at as string, line: `${when(t.due_at as string)} Tugas: ${clip(t.title)}` })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  out.push('3 hari ke depan:', ...(soon.length ? soon.slice(0, 10).map((i) => `- ${i.line}`) : ['- kosong']))
  out.push(`Total tugas belum selesai: ${openCount.count ?? 0}`)

  if (goals.length) {
    out.push('Target aktif:', ...goals.slice(0, 8).map((g) => `- ${clip(g.title)}: ${g.percent}% (${goalNumbers(g).summary}${g.due_date ? `, tenggat ${g.due_date}` : ''})`))
  } else out.push('Target aktif: tidak ada')

  let inc = 0, exp = 0, expToday = 0
  for (const t of tx.data ?? []) {
    const a = Number(t.amount)
    if (t.type === 'pemasukan') inc += a
    else { exp += a; if (t.occurred_on === today) expToday += a }
  }
  const active = new Set((accts.data ?? []).map((a) => a.id))
  const saldo = (bal.data ?? []).filter((b) => active.has(b.account_id)).reduce((n, b) => n + Number(b.balance), 0)
  out.push(`Keuangan bulan ini: pemasukan ${formatRupiah(inc)}, pengeluaran ${formatRupiah(exp)}, keluar hari ini ${formatRupiah(expToday)}, saldo semua rekening ${formatRupiah(saldo)}.`)

  const hs = habits.data ?? []
  if (hs.length) {
    const done = new Set((checks.data ?? []).map((c) => c.habit_id))
    const todo = hs.filter((h) => !done.has(h.id)).map((h) => clip(h.name, 30))
    out.push(`Kebiasaan harian: ${hs.length - todo.length}/${hs.length} sudah check-in hari ini${todo.length ? ` (belum: ${todo.slice(0, 6).join(', ')})` : ''}.`)
  }

  const ts = timers.data ?? []
  if (ts.length) out.push('Pengingat/timer terjadwal:', ...ts.map((t) => `- ${when(t.fire_at)} ${t.kind === 'ingat' ? 'pengingat' : t.kind}${t.label ? `: ${clip(t.label, 50)}` : ''}`))

  const text = out.join('\n')
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text
}
