'use server'

import { startOfDayIso, addDays, todayIn } from '@/lib/dates'
import { formatShort, formatTime } from '@/lib/format'
import { createClient, getCurrentUser } from '@/lib/supabase/server'

export type SearchKind = 'tugas' | 'kegiatan' | 'catatan' | 'target' | 'proyek' | 'bidang' | 'kebiasaan'
export interface SearchHit { kind: SearchKind; id: string; title: string; sub: string; href: string }

/** Pencarian global di header: judul tugas, catatan (judul & isi), target, proyek, bidang belajar, kebiasaan. */
export async function globalSearch(raw: string): Promise<SearchHit[]> {
  const user = await getCurrentUser()
  if (!user) return []
  const q = raw.replace(/[%_\\,()]/g, ' ').trim().slice(0, 80)
  if (q.length < 2) return []
  const like = `%${q}%`
  const supabase = await createClient()
  const [tasks, notes, goals, projects, subjects, habits] = await Promise.all([
    supabase.from('tasks').select('id, kind, title, status').ilike('title', like).order('updated_at', { ascending: false }).limit(6),
    supabase.from('journal_entries').select('id, title, entry_date').or(`title.ilike.${like},content.ilike.${like}`).order('entry_date', { ascending: false }).limit(5),
    supabase.from('goals').select('id, title, status').ilike('title', like).limit(4),
    supabase.from('projects').select('id, title, status').ilike('title', like).limit(4),
    supabase.from('learning_subjects').select('id, title').ilike('title', like).limit(4),
    supabase.from('habits').select('id, name').ilike('name', like).eq('is_archived', false).limit(4),
  ])
  return [
    ...(tasks.data ?? []).map((t) => ({ kind: t.kind as SearchKind, id: t.id, title: t.title, sub: t.kind === 'kegiatan' ? 'Kegiatan' : t.status === 'selesai' ? 'Tugas · selesai' : 'Tugas', href: `/tugas/${t.id}` })),
    ...(notes.data ?? []).map((n) => ({ kind: 'catatan' as const, id: n.id, title: n.title || 'Tanpa judul', sub: 'Catatan', href: `/jurnal/${n.id}` })),
    ...(goals.data ?? []).map((g) => ({ kind: 'target' as const, id: g.id, title: g.title, sub: 'Target', href: `/target/${g.id}` })),
    ...(projects.data ?? []).map((p) => ({ kind: 'proyek' as const, id: p.id, title: p.title, sub: 'Proyek', href: `/proyek/${p.id}` })),
    ...(subjects.data ?? []).map((s) => ({ kind: 'bidang' as const, id: s.id, title: s.title, sub: 'Bidang belajar', href: `/belajar/${s.id}` })),
    ...(habits.data ?? []).map((h) => ({ kind: 'kebiasaan' as const, id: h.id, title: h.name, sub: 'Kebiasaan', href: '/kebiasaan' })),
  ]
}

export type NotifKind = 'terlambat' | 'hari-ini' | 'kegiatan' | 'lencana'
export interface Notif { key: string; kind: NotifKind; title: string; sub: string; href: string; at: string; read: boolean }

/**
 * Notifikasi di header: tugas terlambat, tenggat & kegiatan hari ini (perlu tindakan → dihitung di angka lonceng),
 * dan lencana yang baru diraih 7 hari terakhir.
 */
export async function loadNotifications(): Promise<{ items: Notif[]; unread: number } | null> {
  const user = await getCurrentUser()
  if (!user) return null
  const tz = user.timezone
  const today = todayIn(tz)
  const now = new Date().toISOString()
  const dayStart = startOfDayIso(today, tz)
  const dayEnd = startOfDayIso(addDays(today, 1), tz)
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const supabase = await createClient()
  const open = ['belum', 'dikerjakan', 'tertunda']
  const [late, dueToday, events, badges] = await Promise.all([
    supabase.from('tasks').select('id, title, due_at').eq('kind', 'tugas').in('status', open).lt('due_at', now).order('due_at', { ascending: false }).limit(10),
    supabase.from('tasks').select('id, title, due_at').eq('kind', 'tugas').in('status', open).gte('due_at', now).lt('due_at', dayEnd).order('due_at').limit(10),
    supabase.from('tasks').select('id, title, start_at, location').eq('kind', 'kegiatan').in('status', open).gte('start_at', dayStart).lt('start_at', dayEnd).order('start_at').limit(10),
    supabase.from('user_achievements').select('id, earned_at, achievements(name)').gte('earned_at', weekAgo).order('earned_at', { ascending: false }).limit(5),
  ])
  const raw: Omit<Notif, 'read'>[] = [
    ...(late.data ?? []).map((t) => ({ key: `late-${t.id}`, kind: 'terlambat' as const, title: t.title, sub: `Terlambat · tenggat ${formatShort(t.due_at!, tz)}`, href: `/tugas/${t.id}`, at: t.due_at! })),
    ...(dueToday.data ?? []).map((t) => ({ key: `due-${t.id}`, kind: 'hari-ini' as const, title: t.title, sub: `Tenggat hari ini · ${formatTime(t.due_at!, tz)}`, href: `/tugas/${t.id}`, at: t.due_at! })),
    ...(events.data ?? []).map((t) => ({ key: `ev-${t.id}`, kind: 'kegiatan' as const, title: t.title, sub: `Kegiatan hari ini · ${formatTime(t.start_at!, tz)}${t.location ? ` · ${t.location}` : ''}`, href: `/tugas/${t.id}`, at: t.start_at! })),
    ...(badges.data ?? []).map((b) => {
      const a = b.achievements as unknown as { name: string } | { name: string }[] | null
      const name = Array.isArray(a) ? a[0]?.name : a?.name
      return { key: `badge-${b.id}`, kind: 'lencana' as const, title: `Lencana baru: ${name ?? 'Pencapaian'}`, sub: `Diraih ${formatShort(b.earned_at, tz)}`, href: '/pencapaian', at: b.earned_at }
    }),
  ]
  // Tandai yang sudah dibaca; yang belum dibaca tampil lebih dulu.
  const reads = raw.length ? await supabase.from('notification_reads').select('key').in('key', raw.map((i) => i.key)) : { data: [] }
  const readSet = new Set((reads.data ?? []).map((r) => r.key))
  const items: Notif[] = raw.map((i) => ({ ...i, read: readSet.has(i.key) }))
  items.sort((a, b) => Number(a.read) - Number(b.read))
  return { items, unread: items.filter((i) => !i.read).length }
}

const NOTIF_KEY = /^(late|due|ev|badge)-[0-9a-f-]{36}$/

/** Tandai notifikasi sudah dibaca (satu, atau banyak untuk "Tandai semua dibaca"). Sekali dibaca tetap dibaca. */
export async function markNotificationsRead(keys: string[]): Promise<{ ok: boolean }> {
  const user = await getCurrentUser()
  if (!user) return { ok: false }
  const valid = [...new Set(keys)].filter((k) => typeof k === 'string' && NOTIF_KEY.test(k)).slice(0, 50)
  if (!valid.length) return { ok: true }
  const supabase = await createClient()
  const { error } = await supabase.from('notification_reads').upsert(valid.map((key) => ({ user_id: user.id, key })), { onConflict: 'user_id,key', ignoreDuplicates: true })
  // Bersihkan catatan lama (notifikasinya sudah tidak relevan) agar tabel tetap kecil.
  await supabase.from('notification_reads').delete().eq('user_id', user.id).lt('read_at', new Date(Date.now() - 60 * 86_400_000).toISOString())
  return { ok: !error }
}
