import 'server-only'
import { randomUUID } from 'node:crypto'
import { todayIn, zonedToIso } from '../dates'
import { formatRupiah } from '../format'
import type { Named, Ref, RefKind, Snapshot } from './aiContext'
import { cut, esc, type Ctx } from './ui'
import { minutesLabel, whenLabel } from './when'

/*
 * Operasi Rupi AI atas data yang SUDAH ada (ubah / selesaikan / hapus / progres / check-in / transfer …).
 * Model menyebut item dengan kode dari ringkasan data (T1, X3, G1, …); di sini kode diterjemahkan ke id
 * milik pengguna, setiap isian divalidasi, lalu usulan ditampilkan dengan tombol konfirmasi.
 * Eksekusi selalu dibatasi user_id pengguna (service role melewati RLS).
 */

export type OpName =
  | 'ubah_tugas' | 'status_tugas' | 'hapus_tugas'
  | 'ubah_transaksi' | 'hapus_transaksi' | 'transfer' | 'anggaran'
  | 'progres_target' | 'tambah_target' | 'ubah_target'
  | 'sesi_belajar' | 'checkin' | 'tambah_kebiasaan' | 'arsip_kebiasaan'
  | 'ubah_proyek' | 'ubah_jurnal' | 'hapus_jurnal' | 'batal_pengingat'
type Val = string | number | boolean | null
export interface AiOp { op: OpName; id?: string; label: string; f: Record<string, Val> }

export const MAX_OPS = 8
const TASK_STATUS = ['belum', 'dikerjakan', 'tertunda', 'selesai', 'dibatalkan']
const PRIORITY = ['rendah', 'sedang', 'tinggi']
const GOAL_STATUS = ['aktif', 'tercapai', 'arsip']
const PROJECT_STATUS = ['rencana', 'aktif', 'selesai', 'ditunda', 'arsip']
const METRICS = ['rupiah', 'jumlah', 'durasi', 'persentase']

type Raw = Record<string, unknown>
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.')) : NaN
  return Number.isFinite(n) ? n : null
}
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : '')
const findNamed = <T extends Named>(list: T[], name: unknown): T | undefined => {
  const q = str(name, 80).toLowerCase()
  if (!q) return undefined
  return list.find((x) => x.name.toLowerCase() === q) ?? list.find((x) => x.name.toLowerCase().includes(q) || q.includes(x.name.toLowerCase()))
}

/** "waktu" (YYYY-MM-DDTHH:MM) + "jam" (HH:MM, menang) → ISO; null bila tidak ada / tidak valid. */
function moment(r: Raw, tz: string, today: string): string | null {
  const w = typeof r.waktu === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.waktu) ? r.waktu : ''
  const jam = typeof r.jam === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.jam) ? r.jam : ''
  if (!w && !jam) return null
  const local = jam ? `${(w || today).slice(0, 10)}T${jam}` : w
  return zonedToIso(local, tz) ?? null
}

/** Terjemahkan & validasi usulan operasi dari model. Usulan yang tidak valid dibuang diam-diam. */
export function normalizeOps(raw: unknown, snap: Snapshot, tz: string): AiOp[] {
  if (!Array.isArray(raw)) return []
  const today = todayIn(tz)
  const out: AiOp[] = []
  for (const item of raw.slice(0, MAX_OPS * 2)) {
    if (!item || typeof item !== 'object') continue
    const r = item as Raw
    const op = String(r.op ?? '').trim().toLowerCase() as OpName
    const refOf = (kind: RefKind): Ref | null => {
      const x = snap.refs[String(r.ref ?? '').trim().toUpperCase()]
      return x && x.kind === kind ? x : null
    }
    const push = (o: AiOp) => { if (out.length < MAX_OPS) out.push(o) }

    switch (op) {
      case 'ubah_tugas': {
        const ref = refOf('tugas'); if (!ref) break
        const f: Record<string, Val> = { kind: String(ref.extra.kind ?? 'tugas') }
        const title = str(r.judul, 200); if (title) f.title = title
        const at = moment(r, tz, today); if (at) f.at = at
        const pr = str(r.prioritas, 10); if (PRIORITY.includes(pr)) f.priority = pr
        const place = str(r.lokasi, 100); if (place && f.kind === 'kegiatan') f.place = place
        // Durasi hanya bila benar-benar berubah (model kadang mengulang durasi lama).
        const oldMin = ref.extra.start_at && ref.extra.end_at ? Math.round((new Date(String(ref.extra.end_at)).getTime() - new Date(String(ref.extra.start_at)).getTime()) / 60_000) : null
        const m = num(r.durasi_menit); if (m && m >= 5 && m <= 1440 && f.kind === 'kegiatan' && Math.round(m) !== oldMin) f.minutes = Math.round(m)
        if (Object.keys(f).length === 1) break
        if (f.kind === 'kegiatan') { f.oldStart = (ref.extra.start_at as string) ?? null; f.oldEnd = (ref.extra.end_at as string) ?? null }
        push({ op, id: ref.id, label: ref.label, f })
        break
      }
      case 'status_tugas': {
        const ref = refOf('tugas'); const status = str(r.status, 12)
        if (ref && TASK_STATUS.includes(status)) push({ op, id: ref.id, label: ref.label, f: { status, kind: String(ref.extra.kind ?? 'tugas') } })
        break
      }
      case 'hapus_tugas': {
        const ref = refOf('tugas'); if (ref) push({ op, id: ref.id, label: ref.label, f: { kind: String(ref.extra.kind ?? 'tugas') } })
        break
      }
      case 'ubah_transaksi': {
        const ref = refOf('transaksi'); if (!ref) break
        const f: Record<string, Val> = {}
        const amount = num(r.jumlah); if (amount && amount > 0 && amount < 1e13) f.amount = Math.round(amount)
        const cat = findNamed(snap.categories.filter((c) => c.type === ref.extra.type), r.kategori); if (cat) { f.category = cat.id; f.categoryName = cat.name }
        const acc = findNamed(snap.accounts, r.rekening); if (acc) { f.account = acc.id; f.accountName = acc.name }
        const note = typeof r.catatan === 'string' ? str(r.catatan, 500) : null; if (note !== null && r.catatan !== undefined && note !== String(ref.extra.note ?? '')) f.note = note
        const d = day(r.tanggal); if (d && d <= today) f.date = d
        if (Object.keys(f).length) push({ op, id: ref.id, label: ref.label, f })
        break
      }
      case 'hapus_transaksi': {
        const ref = refOf('transaksi'); if (ref) push({ op, id: ref.id, label: ref.label, f: {} })
        break
      }
      case 'transfer': {
        const from = findNamed(snap.accounts, r.dari), to = findNamed(snap.accounts, r.ke), amount = num(r.jumlah)
        if (from && to && from.id !== to.id && amount && amount > 0 && amount < 1e13) {
          push({ op, label: `${from.name} → ${to.name}`, f: { from: from.id, fromName: from.name, to: to.id, toName: to.name, amount: Math.round(amount), note: str(r.catatan, 500) } })
        }
        break
      }
      case 'anggaran': {
        const cat = findNamed(snap.categories.filter((c) => c.type === 'pengeluaran'), r.kategori), amount = num(r.jumlah)
        if (cat && amount && amount > 0 && amount < 1e13) push({ op, label: cat.name, f: { category: cat.id, amount: Math.round(amount) } })
        break
      }
      case 'progres_target': {
        const ref = refOf('target'), value = num(r.nilai)
        if (ref && ref.extra.manual && value && Math.abs(value) < 1e13) push({ op, id: ref.id, label: ref.label, f: { value, unit: String(ref.extra.unit ?? ''), metric: String(ref.extra.metric ?? ''), note: str(r.catatan, 500) } })
        break
      }
      case 'tambah_target': {
        const title = str(r.judul, 160), target = num(r.target)
        if (!title || !target || target <= 0 || target >= 1e13) break
        const metric = METRICS.includes(str(r.jenis, 12)) ? str(r.jenis, 12) : /rp|rupiah/i.test(String(r.satuan ?? '')) ? 'rupiah' : 'jumlah'
        const due = day(r.tenggat)
        push({ op, label: title, f: { title, target, unit: metric === 'rupiah' ? '' : str(r.satuan, 30), metric, due: due && due >= today ? due : null } })
        break
      }
      case 'ubah_target': {
        const ref = refOf('target'); if (!ref) break
        const f: Record<string, Val> = {}
        const title = str(r.judul, 160); if (title) f.title = title
        const target = num(r.target); if (target && target > 0 && target < 1e13 && ref.extra.manual) f.target = target
        const due = day(r.tenggat); if (due) f.due = due
        const st = str(r.status, 10); if (GOAL_STATUS.includes(st)) f.status = st
        if (Object.keys(f).length) push({ op, id: ref.id, label: ref.label, f })
        break
      }
      case 'sesi_belajar': {
        const ref = refOf('belajar'), m = num(r.menit)
        if (ref && m && m >= 1 && m <= 1440) push({ op, id: ref.id, label: ref.label, f: { minutes: Math.round(m), material: str(r.materi, 200) } })
        break
      }
      case 'checkin': {
        const ref = refOf('kebiasaan')
        if (ref && !ref.extra.doneToday) push({ op, id: ref.id, label: ref.label, f: {} })
        break
      }
      case 'tambah_kebiasaan': {
        const name = str(r.nama, 80); if (!name) break
        const frequency = str(r.frekuensi, 10) === 'mingguan' ? 'mingguan' : 'harian'
        const n = num(r.kali_per_minggu)
        push({ op, label: name, f: { name, frequency, perWeek: frequency === 'harian' ? 7 : Math.min(7, Math.max(1, Math.round(n ?? 3))) } })
        break
      }
      case 'arsip_kebiasaan': {
        const ref = refOf('kebiasaan'); if (ref) push({ op, id: ref.id, label: ref.label, f: {} })
        break
      }
      case 'ubah_proyek': {
        const ref = refOf('proyek'); if (!ref) break
        const f: Record<string, Val> = {}
        const st = str(r.status, 10); if (PROJECT_STATUS.includes(st)) f.status = st
        const due = day(r.tenggat); if (due) f.due = due
        if (Object.keys(f).length) push({ op, id: ref.id, label: ref.label, f })
        break
      }
      case 'ubah_jurnal': {
        const ref = refOf('jurnal'); if (!ref) break
        const f: Record<string, Val> = {}
        const title = str(r.judul, 200); if (title) f.title = title
        const content = text(r.isi, 50000); if (content) f.content = content
        if (Object.keys(f).length) push({ op, id: ref.id, label: ref.label, f })
        break
      }
      case 'hapus_jurnal': {
        const ref = refOf('jurnal'); if (ref) push({ op, id: ref.id, label: ref.label, f: {} })
        break
      }
      case 'batal_pengingat': {
        const ref = refOf('pengingat'); if (ref) push({ op, id: ref.id, label: ref.label, f: {} })
        break
      }
    }
  }
  return out
}

const fmtVal = (o: AiOp) => (o.f.metric === 'rupiah' ? formatRupiah(Number(o.f.value)) : `${o.f.value}${o.f.unit ? ` ${o.f.unit}` : ''}`)
const STATUS_LABEL: Record<string, string> = { selesai: 'selesai ✅', dikerjakan: 'sedang dikerjakan', belum: 'belum dikerjakan', tertunda: 'tertunda', dibatalkan: 'dibatalkan' }

/** Satu baris ringkasan usulan operasi (HTML Telegram). */
export function describeOp(o: AiOp, tz: string): string {
  const L = cut(o.label, 50)
  const f = o.f
  switch (o.op) {
    case 'ubah_tugas': {
      const parts = [f.title ? `judul → “${esc(String(f.title))}”` : '', f.at ? `waktu → ${whenLabel(String(f.at), tz)}` : '', f.priority ? `prioritas → ${f.priority}` : '', f.place ? `lokasi → ${esc(String(f.place))}` : '', f.minutes ? `durasi → ${minutesLabel(Number(f.minutes))}` : ''].filter(Boolean)
      return `✏️ <b>Ubah ${f.kind === 'kegiatan' ? 'kegiatan' : 'tugas'}</b> — ${L}: ${parts.join(', ')}`
    }
    case 'status_tugas': return `${f.status === 'selesai' ? '✔️' : '🔄'} <b>${f.kind === 'kegiatan' ? 'Kegiatan' : 'Tugas'}</b> — ${L} → ${STATUS_LABEL[String(f.status)] ?? f.status}`
    case 'hapus_tugas': return `🗑 <b>Hapus ${f.kind === 'kegiatan' ? 'kegiatan' : 'tugas'}</b> — ${L}`
    case 'ubah_transaksi': {
      const parts = [f.amount ? `jumlah → ${formatRupiah(Number(f.amount))}` : '', f.categoryName ? `kategori → ${esc(String(f.categoryName))}` : '', f.accountName ? `rekening → ${esc(String(f.accountName))}` : '', f.note !== undefined ? `catatan → “${esc(String(f.note))}”` : '', f.date ? `tanggal → ${f.date}` : ''].filter(Boolean)
      return `✏️ <b>Ubah transaksi</b> — ${L}: ${parts.join(', ')}`
    }
    case 'hapus_transaksi': return `🗑 <b>Hapus transaksi</b> — ${L}`
    case 'transfer': return `🔁 <b>Transfer ${formatRupiah(Number(f.amount))}</b> — ${esc(String(f.fromName))} → ${esc(String(f.toName))}${f.note ? ` · ${cut(String(f.note), 40)}` : ''}`
    case 'anggaran': return `📊 <b>Anggaran bulan ini</b> — ${L}: ${formatRupiah(Number(f.amount))}`
    case 'progres_target': return `🎯 <b>Progres target</b> — ${L}: ${Number(f.value) > 0 ? '+' : ''}${fmtVal(o)}${f.note ? ` · ${cut(String(f.note), 40)}` : ''}`
    case 'tambah_target': return `🎯 <b>Target baru</b> — ${L}: ${f.metric === 'rupiah' ? formatRupiah(Number(f.target)) : `${f.target}${f.unit ? ` ${f.unit}` : ''}`}${f.due ? ` · tenggat ${f.due}` : ''}`
    case 'ubah_target': {
      const parts = [f.title ? `judul → “${esc(String(f.title))}”` : '', f.target ? `target → ${f.target}` : '', f.due ? `tenggat → ${f.due}` : '', f.status ? `status → ${f.status}` : ''].filter(Boolean)
      return `✏️ <b>Ubah target</b> — ${L}: ${parts.join(', ')}`
    }
    case 'sesi_belajar': return `📚 <b>Sesi belajar</b> — ${L}: ${minutesLabel(Number(f.minutes))}${f.material ? ` · ${cut(String(f.material), 40)}` : ''}`
    case 'checkin': return `🔁 <b>Check-in kebiasaan</b> — ${L} (hari ini)`
    case 'tambah_kebiasaan': return `🔁 <b>Kebiasaan baru</b> — ${L}: ${f.frequency === 'harian' ? 'harian' : `${f.perWeek}×/minggu`}`
    case 'arsip_kebiasaan': return `📦 <b>Arsipkan kebiasaan</b> — ${L}`
    case 'ubah_proyek': return `✏️ <b>Ubah proyek</b> — ${L}: ${[f.status ? `status → ${f.status}` : '', f.due ? `tenggat → ${f.due}` : ''].filter(Boolean).join(', ')}`
    case 'ubah_jurnal': return `✏️ <b>Ubah catatan</b> — ${L}${f.title ? `: judul → “${esc(String(f.title))}”` : ''}${f.content ? ' (isi diganti)' : ''}`
    case 'hapus_jurnal': return `🗑 <b>Hapus catatan</b> — ${L}`
    case 'batal_pengingat': return `🔕 <b>Batalkan pengingat</b> — ${L}`
  }
}

/** Jalankan satu operasi; true = berhasil. Semua query dibatasi user_id. */
async function run(ctx: Ctx, o: AiOp): Promise<boolean> {
  const db = ctx.db, uid = ctx.userId, f = o.f, today = todayIn(ctx.tz)
  const changed = async (q: PromiseLike<{ data: unknown[] | null; error: unknown }>) => {
    const { data, error } = await q
    return !error && Array.isArray(data) && data.length > 0
  }
  switch (o.op) {
    case 'ubah_tugas': {
      const patch: Record<string, unknown> = {}
      if (f.title) patch.title = f.title
      if (f.priority) patch.priority = f.priority
      if (f.kind === 'kegiatan') {
        if (f.place) patch.location = f.place
        const oldStart = f.oldStart ? new Date(String(f.oldStart)).getTime() : null
        const oldLen = oldStart && f.oldEnd ? new Date(String(f.oldEnd)).getTime() - oldStart : null
        const start = f.at ? new Date(String(f.at)).getTime() : oldStart
        if (f.at) patch.start_at = f.at
        const len = f.minutes ? Number(f.minutes) * 60_000 : oldLen
        if (start && len && (f.at || f.minutes)) patch.end_at = new Date(start + len).toISOString()
      } else if (f.at) patch.due_at = f.at
      return changed(db.from('tasks').update(patch).eq('id', o.id!).eq('user_id', uid).select('id'))
    }
    case 'status_tugas': return changed(db.from('tasks').update({ status: f.status }).eq('id', o.id!).eq('user_id', uid).select('id'))
    case 'hapus_tugas': return changed(db.from('tasks').delete().eq('id', o.id!).eq('user_id', uid).select('id'))
    case 'ubah_transaksi': {
      const patch: Record<string, unknown> = {}
      if (f.amount) patch.amount = f.amount
      if (f.category) patch.category_id = f.category
      if (f.account) patch.account_id = f.account
      if (f.note !== undefined) patch.note = f.note
      if (f.date) patch.occurred_on = f.date
      return changed(db.from('transactions').update(patch).eq('id', o.id!).eq('user_id', uid).in('type', ['pemasukan', 'pengeluaran']).select('id'))
    }
    case 'hapus_transaksi': return changed(db.from('transactions').delete().eq('id', o.id!).eq('user_id', uid).in('type', ['pemasukan', 'pengeluaran']).select('id'))
    case 'transfer': {
      const group = randomUUID()
      const base = { user_id: uid, amount: f.amount, occurred_on: today, note: f.note ?? '', transfer_group_id: group, category_id: null }
      return changed(db.from('transactions').insert([{ ...base, account_id: f.from, type: 'transfer_keluar' }, { ...base, account_id: f.to, type: 'transfer_masuk' }]).select('id'))
    }
    case 'anggaran':
      return changed(db.from('budgets').upsert({ user_id: uid, category_id: f.category, month: `${today.slice(0, 7)}-01`, limit_amount: f.amount }, { onConflict: 'user_id,category_id,month' }).select('id'))
    case 'progres_target':
      return changed(db.from('goal_progress_events').insert({ user_id: uid, goal_id: o.id, value: f.value, note: f.note ?? '', occurred_on: today, source_type: 'manual' }).select('id'))
    case 'tambah_target':
      return changed(db.from('goals').insert({ user_id: uid, title: f.title, metric_type: f.metric, unit_label: f.unit ?? '', start_value: 0, target_value: f.target, direction: 'naik', start_date: today, due_date: f.due, priority: 'sedang' }).select('id'))
    case 'ubah_target': {
      const patch: Record<string, unknown> = {}
      if (f.title) patch.title = f.title
      if (f.target) patch.target_value = f.target
      if (f.due) patch.due_date = f.due
      if (f.status) patch.status = f.status
      return changed(db.from('goals').update(patch).eq('id', o.id!).eq('user_id', uid).select('id'))
    }
    case 'sesi_belajar':
      return changed(db.from('learning_sessions').insert({ user_id: uid, subject_id: o.id, duration_minutes: f.minutes, material: f.material ?? '', session_date: today }).select('id'))
    case 'checkin':
      return changed(db.from('habit_checkins').insert({ user_id: uid, habit_id: o.id, checkin_date: today }).select('id'))
    case 'tambah_kebiasaan':
      return changed(db.from('habits').insert({ user_id: uid, name: f.name, frequency: f.frequency, times_per_week: f.perWeek }).select('id'))
    case 'arsip_kebiasaan': return changed(db.from('habits').update({ is_archived: true }).eq('id', o.id!).eq('user_id', uid).select('id'))
    case 'ubah_proyek': {
      const patch: Record<string, unknown> = {}
      if (f.status) patch.status = f.status
      if (f.due) patch.due_date = f.due
      return changed(db.from('projects').update(patch).eq('id', o.id!).eq('user_id', uid).select('id'))
    }
    case 'ubah_jurnal': {
      const patch: Record<string, unknown> = {}
      if (f.title) patch.title = f.title
      if (f.content) patch.content = f.content
      return changed(db.from('journal_entries').update(patch).eq('id', o.id!).eq('user_id', uid).select('id'))
    }
    case 'hapus_jurnal': return changed(db.from('journal_entries').delete().eq('id', o.id!).eq('user_id', uid).select('id'))
    case 'batal_pengingat': return changed(db.from('bot_timers').delete().eq('id', o.id!).eq('user_id', uid).is('sent_at', null).select('id'))
  }
}

/** Jalankan semua operasi; kembalikan baris hasil per operasi. */
export async function executeOps(ctx: Ctx, ops: AiOp[]): Promise<string[]> {
  const lines: string[] = []
  for (const o of ops.slice(0, MAX_OPS)) {
    let ok = false
    try { ok = await run(ctx, o) } catch { ok = false }
    lines.push(`${ok ? '✓' : '✗'} ${describeOp(o, ctx.tz)}${ok ? '' : ' <i>(gagal — mungkin sudah berubah / dihapus)</i>'}`)
  }
  return lines
}
