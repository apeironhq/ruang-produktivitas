import 'server-only'
import { addDays, todayIn, zonedToIso } from '../dates'
import { formatNumber, formatRupiah, parseIdNumber } from '../format'
import { JOURNAL_KIND, MOOD } from '../labels'
import { editMessageCaption, editMessageKb, editMessageReplyMarkup, sendMessageKb, type Keyboard } from '../telegram'
import { createTimer, splitReminder } from './timers'
import { btn, cut, esc, rows, tableText, type Ctx } from './ui'
import { extractWhen, guessCategory, minutesLabel, whenLabel } from './when'

/*
 * Isian bertahap ("alur"): satu pesan formulir yang terus diperbarui. Status disimpan di
 * telegram_pending (action 'alur') sehingga jawaban berupa ketikan bisa diteruskan ke langkah
 * berikutnya. Data baru ditulis ke database setelah pengguna menekan ✅ Simpan (BT-04).
 */
export interface FlowState { f: string; s: number; d: Record<string, unknown>; l: Record<string, string>; m?: number; photo?: boolean
  /** kunci langkah yang sudah dijawab pengguna (untuk nomor "Langkah n") */
  q?: string[] }
interface Ask { q: string; hint?: string; choices?: Array<{ text: string; v: string }>; perRow?: number; optional?: boolean; typing?: boolean
  /** langkah tidak relevan (mis. belum punya proyek) → dilewati otomatis dengan nilai ini */
  autoSkip?: { value: unknown } }
type Accepted = { value: unknown; label: string } | { error: string }
interface Step {
  key: string
  label: string
  when?: (st: FlowState) => boolean
  ask: (ctx: Ctx, st: FlowState) => Promise<Ask> | Ask
  accept: (ctx: Ctx, st: FlowState, input: { text?: string; choice?: string }) => Promise<Accepted> | Accepted
}
interface Flow {
  title: string
  steps: Step[]
  init?: (ctx: Ctx, arg: string) => Promise<{ d?: Record<string, unknown>; l?: Record<string, string> } | { error: string }>
  commit: (ctx: Ctx, st: FlowState) => Promise<{ lines: string[]; kb: Keyboard }>
}

const NAV_AFTER = (panel: string, label: string): Keyboard => [[btn(label, panel), btn('🏠 Menu', 'p:home')]]

/* ---------- Langkah umum ---------- */
const textStep = (key: string, label: string, q: string, hint: string, opts: { optional?: boolean; max?: number; when?: Step['when'] } = {}): Step => ({
  key, label, when: opts.when,
  ask: () => ({ q, hint, optional: opts.optional, typing: true }),
  accept: (_c, _s, { text }) => {
    const t = (text ?? '').trim()
    if (!t) return { error: 'Ketik jawabannya dulu, ya.' }
    const v = t.slice(0, opts.max ?? 200)
    return { value: v, label: cut(v, 60) }
  },
})
const remindStep = (): Step => ({
  key: 'remind', label: 'Pengingat', when: (st) => !!st.d.due || !!st.d.start,
  ask: () => ({ q: 'Ingatkan kapan?', choices: [{ text: 'Tanpa', v: '-' }, { text: 'Tepat waktu', v: '0' }, { text: '10 menit', v: '10' }, { text: '30 menit', v: '30' }, { text: '1 jam', v: '60' }, { text: '1 hari', v: '1440' }], perRow: 3 }),
  accept: (_c, _s, { choice }) => {
    if (!choice) return { error: 'Pilih salah satu tombol.' }
    const labels: Record<string, string> = { '-': 'Tanpa pengingat', '0': 'Tepat waktu', '10': '10 menit sebelumnya', '30': '30 menit sebelumnya', '60': '1 jam sebelumnya', '1440': '1 hari sebelumnya' }
    if (!(choice in labels)) return { error: 'Pilihan tidak valid.' }
    return { value: choice === '-' ? null : Number(choice), label: labels[choice]! }
  },
})
const QUICK_TIMES: Record<string, [number, string, string]> = {
  h17: [0, '17:00', 'Hari ini 17.00'], h19: [0, '19:00', 'Hari ini 19.00'], b09: [1, '09:00', 'Besok 09.00'], b19: [1, '19:00', 'Besok 19.00'], l09: [2, '09:00', 'Lusa 09.00'],
}
const whenAccept = (tz: string, input: { text?: string; choice?: string }, allowNone: boolean, defTime: string): Accepted => {
  if (input.choice === 'none' && allowNone) return { value: null, label: 'Tanpa tenggat' }
  if (input.choice && QUICK_TIMES[input.choice]) {
    const [plus, time] = QUICK_TIMES[input.choice]!
    const iso = zonedToIso(`${addDays(todayIn(tz), plus)}T${time}`, tz)!
    return { value: iso, label: whenLabel(iso, tz) }
  }
  const w = input.text ? extractWhen(input.text, tz, { defaultTime: defTime }) : null
  if (!w) return { error: 'Waktunya belum terbaca. Contoh: <code>besok jam 9</code>, <code>jam 4 sore</code>, <code>jumat 14.30</code>, <code>20/11</code>.' }
  return { value: w.iso, label: whenLabel(w.iso, tz) }
}

/* ---------- Definisi alur ---------- */
export const FLOWS: Record<string, Flow> = {
  tugas: {
    title: 'Tugas baru',
    init: async (ctx, arg) => {
      // arg: "tp:<projectId>" dari halaman proyek, atau teks "judul [besok] [09.00]" dari /tambah.
      if (arg.startsWith('tp:')) {
        const { data: p } = await ctx.db.from('projects').select('id, title').eq('id', arg.slice(3)).eq('user_id', ctx.userId).maybeSingle()
        return p ? { d: { project: p.id }, l: { project: cut(p.title, 40) } } : { error: 'Proyek tidak ditemukan.' }
      }
      if (!arg) return {}
      // "servis motor besok jam 2 siang" → judul "servis motor", tenggat besok 14.00
      const w = extractWhen(arg, ctx.tz, { defaultTime: '23:59' })
      const title = (w?.rest || arg).trim().slice(0, 200)
      const d: Record<string, unknown> = { title }, l: Record<string, string> = { title: cut(title, 60) }
      if (w) { d.due = w.iso; l.due = whenLabel(w.iso, ctx.tz) }
      return { d, l }
    },
    steps: [
      textStep('title', 'Judul', 'Apa judul tugasnya?', 'Ketik judulnya, mis. <i>Kirim laporan mingguan</i>'),
      {
        key: 'due', label: 'Tenggat',
        ask: () => ({ q: 'Kapan tenggatnya?', hint: 'Pilih tombol, atau ketik mis. <code>besok jam 2 siang</code>, <code>jumat 10.00</code>', choices: [{ text: 'Hari ini 17.00', v: 'h17' }, { text: 'Besok 09.00', v: 'b09' }, { text: 'Lusa 09.00', v: 'l09' }, { text: 'Tanpa tenggat', v: 'none' }], perRow: 2, typing: true }),
        accept: (ctx, _s, input) => whenAccept(ctx.tz, input, true, '23:59'),
      },
      remindStep(),
      {
        key: 'priority', label: 'Prioritas',
        ask: () => ({ q: 'Seberapa penting?', choices: [{ text: '🟢 Rendah', v: 'rendah' }, { text: '🔵 Sedang', v: 'sedang' }, { text: '🟠 Tinggi', v: 'tinggi' }, { text: '🔴 Mendesak', v: 'mendesak' }], perRow: 2 }),
        accept: (_c, _s, { choice }) => (choice && ['rendah', 'sedang', 'tinggi', 'mendesak'].includes(choice) ? { value: choice, label: choice[0]!.toUpperCase() + choice.slice(1) } : { error: 'Pilih salah satu tombol.' }),
      },
      {
        key: 'project', label: 'Proyek',
        ask: async (ctx) => {
          const { data } = await ctx.db.from('projects').select('id, title').eq('user_id', ctx.userId).in('status', ['aktif', 'rencana']).order('title').limit(8)
          if (!(data ?? []).length) return { q: '', autoSkip: { value: null } }
          return { q: 'Masukkan ke proyek?', choices: [...(data ?? []).map((p) => ({ text: p.title.length > 28 ? `${p.title.slice(0, 27)}…` : p.title, v: p.id })), { text: 'Tanpa proyek', v: '-' }], perRow: 1 }
        },
        accept: async (ctx, _s, { choice }) => {
          if (choice === '-') return { value: null, label: 'Tanpa proyek' }
          if (!choice) return { error: 'Pilih salah satu tombol.' }
          const { data: p } = await ctx.db.from('projects').select('title').eq('id', choice).eq('user_id', ctx.userId).maybeSingle()
          return p ? { value: choice, label: cut(p.title, 40) } : { error: 'Proyek tidak ditemukan.' }
        },
      },
    ],
    commit: async (ctx, st) => {
      const d = st.d
      const { error } = await ctx.db.from('tasks').insert({
        user_id: ctx.userId, kind: 'tugas', title: d.title, due_at: d.due ?? null, priority: d.priority ?? 'sedang',
        remind_before_minutes: d.due ? (d.remind ?? null) : null, project_id: d.project ?? null,
      })
      if (error) throw error
      return { lines: ['<b>Tugas ditambahkan!</b>'], kb: NAV_AFTER('p:tugas', '✅ Lihat tugas') }
    },
  },

  kegiatan: {
    title: 'Kegiatan baru',
    init: async (ctx, arg) => {
      if (!arg) return {}
      // "rapat tim besok jam 9" → nama "rapat tim", mulai besok 09.00
      const w = extractWhen(arg, ctx.tz, { defaultTime: '09:00' })
      const title = (w?.rest || arg).trim().slice(0, 200)
      const d: Record<string, unknown> = { title }, l: Record<string, string> = { title: cut(title, 60) }
      if (w) { d.start = w.iso; l.start = whenLabel(w.iso, ctx.tz) }
      return { d, l }
    },
    steps: [
      textStep('title', 'Nama kegiatan', 'Apa nama kegiatannya?', 'Mis. <i>Kajian rutin</i>, <i>Rapat tim</i>'),
      {
        key: 'start', label: 'Mulai',
        ask: () => ({ q: 'Kapan mulainya?', hint: 'Pilih tombol, atau ketik mis. <code>besok jam 7 malam</code>, <code>sabtu 08.00</code>', choices: [{ text: 'Hari ini 19.00', v: 'h19' }, { text: 'Besok 09.00', v: 'b09' }, { text: 'Besok 19.00', v: 'b19' }], perRow: 3, typing: true }),
        accept: (ctx, _s, input) => whenAccept(ctx.tz, input, false, '09:00'),
      },
      {
        key: 'dur', label: 'Durasi',
        ask: () => ({ q: 'Berapa lama?', choices: [{ text: '30 menit', v: '30' }, { text: '1 jam', v: '60' }, { text: '2 jam', v: '120' }, { text: '3 jam', v: '180' }, { text: 'Tidak ditentukan', v: '-' }], perRow: 2 }),
        accept: (_c, _s, { choice }) => (choice === '-' ? { value: null, label: 'Tidak ditentukan' } : choice && /^\d+$/.test(choice) ? { value: Number(choice), label: minutesLabel(Number(choice)) } : { error: 'Pilih salah satu tombol.' }),
      },
      textStep('location', 'Lokasi', 'Di mana lokasinya?', 'Ketik lokasinya, atau tekan Lewati.', { optional: true }),
      remindStep(),
    ],
    commit: async (ctx, st) => {
      const d = st.d
      const end = d.dur ? new Date(new Date(String(d.start)).getTime() + Number(d.dur) * 60_000).toISOString() : null
      const { error } = await ctx.db.from('tasks').insert({
        user_id: ctx.userId, kind: 'kegiatan', title: d.title, start_at: d.start, end_at: end, location: d.location ?? '', remind_before_minutes: d.remind ?? null,
      })
      if (error) throw error
      return { lines: ['<b>Kegiatan dijadwalkan!</b>'], kb: NAV_AFTER('p:kal', '📅 Lihat kalender') }
    },
  },

  catatan: {
    title: 'Catatan baru',
    init: async (_ctx, arg) => (arg ? { d: { kind: 'catatan', body: arg.slice(0, 50000) }, l: { kind: 'Catatan', body: cut(arg, 80) } } : {}),
    steps: [
      {
        key: 'kind', label: 'Jenis',
        ask: () => ({ q: 'Jenis catatannya?', choices: ['catatan', 'harian', 'ide', 'pekerjaan', 'belajar'].map((k) => ({ text: JOURNAL_KIND[k]!.label, v: k })), perRow: 2 }),
        accept: (_c, _s, { choice }) => (choice && JOURNAL_KIND[choice] ? { value: choice, label: JOURNAL_KIND[choice]!.label } : { error: 'Pilih salah satu tombol.' }),
      },
      textStep('body', 'Isi', 'Tulis catatannya', 'Baris pertama menjadi judul. Boleh beberapa baris.', { max: 50000 }),
      {
        key: 'mood', label: 'Suasana hati', when: (st) => st.d.kind === 'harian',
        ask: () => ({ q: 'Bagaimana suasana hatimu hari ini?', choices: [['1', '😞'], ['2', '🙁'], ['3', '😐'], ['4', '🙂'], ['5', '😄']].map(([v, e]) => ({ text: e!, v: v! })), perRow: 5, optional: true }),
        accept: (_c, _s, { choice }) => (choice && /^[1-5]$/.test(choice) ? { value: Number(choice), label: MOOD[Number(choice)]! } : { error: 'Pilih salah satu tombol.' }),
      },
    ],
    commit: async (ctx, st) => {
      const text = String(st.d.body ?? '')
      const [first = '', ...rest] = text.split('\n')
      const title = first.length <= 120 ? first.trim() : ''
      const content = title ? rest.join('\n').trim() : text
      const { error } = await ctx.db.from('journal_entries').insert({
        user_id: ctx.userId, kind: st.d.kind ?? 'catatan', title, content, entry_date: todayIn(ctx.tz), mood: st.d.mood ?? null, tags: ['telegram'],
      })
      if (error) throw error
      await ctx.db.rpc('evaluate_achievements_for', { p_user: ctx.userId })
      return { lines: ['<b>Catatan tersimpan!</b>'], kb: NAV_AFTER('p:jurnal', '🗒 Lihat jurnal') }
    },
  },

  sesi: {
    title: 'Sesi belajar',
    init: async (ctx, arg) => {
      const { data: subs } = await ctx.db.from('learning_subjects').select('id, title').eq('user_id', ctx.userId).eq('status', 'aktif').limit(100)
      if (!(subs ?? []).length) return { error: 'Belum ada bidang belajar aktif. Tambahkan bidang di Ruang Belajar (web) dulu.' }
      // "/belajar 45 Next.js middleware" → isi otomatis bidang, durasi, materi.
      const m = /^(\d{1,4})\s*(?:menit|mnt|m)?\s+([\s\S]+)$/i.exec(arg)
      if (!m) return {}
      const rest = m[2]!.trim(), lower = rest.toLowerCase()
      const s = (subs ?? []).filter((x) => lower === x.title.toLowerCase() || lower.startsWith(`${x.title.toLowerCase()} `)).sort((a, b) => b.title.length - a.title.length)[0]
      const minutes = Number(m[1])
      const d: Record<string, unknown> = {}, l: Record<string, string> = {}
      if (minutes >= 1 && minutes <= 1440) { d.minutes = minutes; l.minutes = minutesLabel(minutes) }
      if (s) {
        d.subject = s.id; l.subject = cut(s.title, 40)
        const mat = rest.slice(s.title.length).trim().slice(0, 200)
        if (mat) { d.material = mat; l.material = cut(mat, 60) }
      }
      return { d, l }
    },
    steps: [
      {
        key: 'subject', label: 'Bidang',
        ask: async (ctx) => {
          const { data } = await ctx.db.from('learning_subjects').select('id, title').eq('user_id', ctx.userId).eq('status', 'aktif').order('title').limit(10)
          return { q: 'Bidang apa yang dipelajari?', choices: (data ?? []).map((s) => ({ text: s.title.length > 28 ? `${s.title.slice(0, 27)}…` : s.title, v: s.id })), perRow: 2 }
        },
        accept: async (ctx, _s, { choice }) => {
          if (!choice) return { error: 'Pilih salah satu tombol.' }
          const { data: s } = await ctx.db.from('learning_subjects').select('title').eq('id', choice).eq('user_id', ctx.userId).maybeSingle()
          return s ? { value: choice, label: cut(s.title, 40) } : { error: 'Bidang tidak ditemukan.' }
        },
      },
      {
        key: 'minutes', label: 'Durasi',
        ask: () => ({ q: 'Berapa lama belajarnya?', hint: 'Pilih tombol, atau ketik jumlah menit.', choices: ['15', '25', '30', '45', '60', '90'].map((v) => ({ text: minutesLabel(Number(v)), v })), perRow: 3, typing: true }),
        accept: (_c, _s, { text, choice }) => {
          const n = Number(choice ?? (text ?? '').replace(/\D/g, ''))
          return Number.isInteger(n) && n >= 1 && n <= 1440 ? { value: n, label: minutesLabel(n) } : { error: 'Durasi harus 1–1440 menit.' }
        },
      },
      textStep('material', 'Materi', 'Materi apa yang dipelajari?', 'Mis. <i>Middleware & proxy</i>. Atau tekan Lewati.', { optional: true }),
    ],
    commit: async (ctx, st) => {
      const { error } = await ctx.db.from('learning_sessions').insert({
        user_id: ctx.userId, subject_id: st.d.subject, session_date: todayIn(ctx.tz), duration_minutes: st.d.minutes, material: st.d.material ?? '',
      })
      if (error) throw error
      await ctx.db.rpc('evaluate_achievements_for', { p_user: ctx.userId })
      return { lines: ['<b>Sesi belajar tercatat!</b> Terus semangat'], kb: NAV_AFTER('p:belajar', '📚 Lihat belajar') }
    },
  },

  ingat: {
    title: 'Ingatkan saya',
    init: async (ctx, arg) => {
      if (!arg) return {}
      // "jam 4 sore angkat jemuran" → pesan & waktu langsung terisi
      const p = splitReminder(arg, ctx.tz)
      const d: Record<string, unknown> = {}, l: Record<string, string> = {}
      if (p.label) { d.label = p.label.slice(0, 200); l.label = cut(p.label, 60) }
      if (p.at) { d.at = p.at; l.at = whenLabel(p.at, ctx.tz) }
      return { d, l }
    },
    steps: [
      textStep('label', 'Pesan', 'Ingatkan tentang apa?', 'Mis. <i>Minum obat</i>, <i>Telepon ibu</i>, <i>Angkat jemuran</i>'),
      {
        key: 'at', label: 'Waktu',
        ask: () => ({ q: 'Kapan diingatkan?', hint: 'Pilih tombol, atau ketik mis. <code>45 menit</code>, <code>jam 4 sore</code>, <code>besok pagi</code>', choices: [{ text: '15 menit lagi', v: 'r15' }, { text: '30 menit lagi', v: 'r30' }, { text: '1 jam lagi', v: 'r60' }, { text: '3 jam lagi', v: 'r180' }, { text: 'Besok 09.00', v: 'b09' }], perRow: 2, typing: true }),
        accept: (ctx, _s, { text, choice }) => {
          let iso: string | null = null
          if (choice?.startsWith('r')) iso = new Date(Date.now() + Number(choice.slice(1)) * 60_000).toISOString()
          else if (choice === 'b09') iso = zonedToIso(`${addDays(todayIn(ctx.tz), 1)}T09:00`, ctx.tz)
          else if (text) {
            iso = splitReminder(text, ctx.tz).at
            if (!iso && extractWhen(text, ctx.tz)) return { error: 'Waktunya sudah lewat. Pilih waktu yang akan datang.' }
          }
          if (!iso) return { error: 'Waktunya belum terbaca. Contoh: <code>45 menit</code>, <code>jam 4 sore</code>, <code>besok jam 8</code>.' }
          if (new Date(iso).getTime() <= Date.now()) return { error: 'Waktunya sudah lewat. Pilih waktu yang akan datang.' }
          return { value: iso, label: whenLabel(iso, ctx.tz) }
        },
      },
    ],
    commit: async (ctx, st) => {
      const r = await createTimer(ctx, 'ingat', String(st.d.at), String(st.d.label), null)
      if ('error' in r) return { lines: [`<b>Belum disimpan.</b> ${r.error}`], kb: [[btn('⏱ Timer & Pengingat', 'p:timer'), btn('🏠 Menu', 'p:home')]] }
      return { lines: ['<b>Pengingat dijadwalkan.</b> Rupi akan mengirim notifikasi tepat waktunya.'], kb: [[btn('⏱ Timer & Pengingat', 'p:timer'), btn('🏠 Menu', 'p:home')]] }
    },
  },

  keluar: moneyFlow('pengeluaran'),
  masuk: moneyFlow('pemasukan'),

  prog: {
    title: 'Tambah progres',
    init: async (ctx, arg) => {
      const { data: g } = await ctx.db.from('goals').select('id, title, metric_type, unit_label, progress_source, status').eq('id', arg).eq('user_id', ctx.userId).maybeSingle()
      if (!g) return { error: 'Target tidak ditemukan.' }
      if (g.progress_source !== 'manual') return { error: 'Progres target ini dihitung otomatis, tidak perlu diisi manual.' }
      return { d: { goal: g.id, metric: g.metric_type, unit: g.unit_label }, l: { goal: cut(g.title, 40) } }
    },
    steps: [
      {
        key: 'value', label: 'Jumlah',
        ask: (_c, st) => st.d.metric === 'biner'
          ? { q: 'Tandai target ini tercapai?', choices: [{ text: '✅ Ya, sudah tercapai', v: '1' }], perRow: 1 }
          : { q: `Berapa tambahannya${st.d.unit ? ` (${esc(String(st.d.unit))})` : st.d.metric === 'rupiah' ? ' (Rp)' : st.d.metric === 'durasi' ? ' (menit)' : ''}?`, hint: 'Ketik angkanya, mis. <code>250000</code>. Pakai minus untuk mengurangi.', typing: true },
        accept: (_c, st, { text, choice }) => {
          const n = choice ? Number(choice) : parseIdNumber(text ?? '')
          if (n === null || !Number.isFinite(n) || n === 0) return { error: 'Ketik angka selain 0.' }
          return { value: n, label: st.d.metric === 'rupiah' ? formatRupiah(n) : st.d.metric === 'durasi' ? minutesLabel(n) : formatNumber(n) }
        },
      },
      textStep('note', 'Catatan', 'Ada catatan?', 'Ketik keterangan singkat, atau tekan Lewati.', { optional: true, max: 500 }),
    ],
    commit: async (ctx, st) => {
      const { error } = await ctx.db.from('goal_progress_events').insert({
        user_id: ctx.userId, goal_id: st.d.goal, value: st.d.value, note: st.d.note ?? '', occurred_on: todayIn(ctx.tz), source_type: 'telegram',
      })
      if (error) throw error
      await ctx.db.rpc('evaluate_achievements_for', { p_user: ctx.userId })
      return { lines: ['<b>Progres ditambahkan!</b>'], kb: [[btn('🎯 Lihat target', `gl:${st.d.goal}`), btn('🏠 Menu', 'p:home')]] }
    },
  },

  sub: {
    title: 'Subtugas baru',
    init: async (ctx, arg) => {
      const { data: t } = await ctx.db.from('tasks').select('id, title').eq('id', arg).eq('user_id', ctx.userId).eq('kind', 'tugas').maybeSingle()
      return t ? { d: { task: t.id }, l: { task: cut(t.title, 40) } } : { error: 'Tugas tidak ditemukan.' }
    },
    steps: [textStep('titles', 'Subtugas', 'Apa subtugasnya?', 'Satu per baris untuk menambah beberapa sekaligus.', { max: 8000 })],
    commit: async (ctx, st) => {
      const titles = String(st.d.titles).split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 30).map((s) => s.slice(0, 200))
      const { count } = await ctx.db.from('task_subtasks').select('id', { count: 'exact', head: true }).eq('task_id', st.d.task).eq('user_id', ctx.userId)
      const { error } = await ctx.db.from('task_subtasks').insert(titles.map((title, i) => ({ user_id: ctx.userId, task_id: st.d.task, title, sort_order: (count ?? 0) + i })))
      if (error) throw error
      return { lines: [`<b>${titles.length} subtugas ditambahkan!</b>`], kb: [[btn('📄 Buka tugas', `td:${st.d.task}`), btn('🏠 Menu', 'p:home')]] }
    },
  },
}

function moneyFlow(type: 'pengeluaran' | 'pemasukan'): Flow {
  const out = type === 'pengeluaran'
  return {
    title: out ? 'Catat pengeluaran' : 'Catat pemasukan',
    init: async (ctx, arg) => {
      const { data: accts } = await ctx.db.from('financial_accounts').select('id, name').eq('user_id', ctx.userId).eq('is_archived', false).order('name').limit(20)
      if (!(accts ?? []).length) return { error: 'Belum ada rekening. Tambahkan rekening di menu Keuangan (web) dulu.' }
      const d: Record<string, unknown> = { type }, l: Record<string, string> = {}
      if (accts!.length === 1) { d.account = accts![0]!.id; l.account = cut(accts![0]!.name, 30) }
      // "/keluar 25000 makan siang" atau "beli kopi 25rb" → isi otomatis jumlah & keterangan.
      const m = splitMoney(arg)
      if (m) {
        d.amount = m.amount; l.amount = formatRupiah(m.amount)
        if (m.note) { d.note = m.note.slice(0, 500); l.note = cut(m.note, 60) }
      }
      return { d, l }
    },
    steps: [
      {
        key: 'amount', label: 'Jumlah',
        ask: () => ({ q: `Berapa jumlah ${type}nya?`, hint: 'Ketik angkanya, mis. <code>25000</code>, <code>25rb</code>, atau <code>1,5jt</code>.', typing: true }),
        accept: (_c, _s, { text }) => {
          const n = parseMoney(text ?? '')
          return n ? { value: n, label: formatRupiah(n) } : { error: 'Jumlah tidak valid. Contoh: <code>25000</code> atau <code>25rb</code>.' }
        },
      },
      {
        key: 'category', label: 'Kategori',
        ask: async (ctx, st) => {
          const { data } = await ctx.db.from('transaction_categories').select('id, name').eq('user_id', ctx.userId).eq('type', type).order('name').limit(12)
          if (!(data ?? []).length) return { q: '', autoSkip: { value: null } }
          // Tebak dari keterangan ("makan siang" → Makan & minum) dan taruh paling depan.
          const g = guessCategory(String(st.d.note ?? ''), data ?? [])
          const list = g ? [g, ...(data ?? []).filter((c) => c.id !== g.id)] : (data ?? [])
          return {
            q: 'Kategorinya apa?',
            ...(g ? { hint: `Saran Rupi: <b>${esc(g.name)}</b> — tekan ✨ bila sesuai.` } : {}),
            choices: list.map((c) => ({ text: c.id === g?.id ? `✨ ${c.name}` : c.name, v: c.id })), perRow: 2, optional: true,
          }
        },
        accept: async (ctx, _s, { choice }) => {
          if (!choice) return { error: 'Pilih salah satu tombol.' }
          const { data: c } = await ctx.db.from('transaction_categories').select('name').eq('id', choice).eq('user_id', ctx.userId).eq('type', type).maybeSingle()
          return c ? { value: choice, label: c.name } : { error: 'Kategori tidak ditemukan.' }
        },
      },
      {
        key: 'account', label: 'Rekening',
        ask: async (ctx) => {
          const { data } = await ctx.db.from('financial_accounts').select('id, name').eq('user_id', ctx.userId).eq('is_archived', false).order('name').limit(12)
          return { q: out ? 'Dibayar dari rekening mana?' : 'Masuk ke rekening mana?', choices: (data ?? []).map((a) => ({ text: a.name, v: a.id })), perRow: 2 }
        },
        accept: async (ctx, _s, { choice }) => {
          if (!choice) return { error: 'Pilih salah satu tombol.' }
          const { data: a } = await ctx.db.from('financial_accounts').select('name').eq('id', choice).eq('user_id', ctx.userId).maybeSingle()
          return a ? { value: choice, label: a.name } : { error: 'Rekening tidak ditemukan.' }
        },
      },
      textStep('note', 'Keterangan', 'Keterangannya?', 'Mis. <i>makan siang</i>. Atau tekan Lewati.', { optional: true, max: 500 }),
    ],
    commit: async (ctx, st) => {
      const { error } = await ctx.db.from('transactions').insert({
        user_id: ctx.userId, account_id: st.d.account, type, amount: st.d.amount, category_id: st.d.category ?? null, occurred_on: todayIn(ctx.tz), note: st.d.note ?? '',
      })
      if (error) throw error
      return { lines: [`<b>${out ? 'Pengeluaran' : 'Pemasukan'} ${formatRupiah(Number(st.d.amount))} tercatat!</b>`], kb: NAV_AFTER('p:uang', '💰 Lihat keuangan') }
    },
  }
}

/**
 * Cari nominal di mana pun dalam teks: "beli kopi 25rb", "Rp35.000 makan siang", "gaji 5 juta".
 * Angka polos tanpa Rp/rb/jt baru dianggap nominal bila minimal 3 digit (hindari "2 buku"). Sisa teks = keterangan.
 */
export function splitMoney(raw: string): { amount: number; note: string } | null {
  const text = raw.trim()
  const re = /(^|\s)(rp\.?\s*)?(\d[\d.,]*)\s*(rb|ribu|k|jt|juta)?(?=\s|$|[!?;:])/gi
  for (const m of text.matchAll(re)) {
    const [whole, lead, rp, num, unit] = m
    if (!rp && !unit && num!.replace(/\D/g, '').length < 3) continue
    if (!rp && !unit && /^\d{1,2}[.:]\d{2}$/.test(num!)) continue // jam, mis. 14.30
    const amount = parseMoney(`${num}${unit ?? ''}`)
    if (!amount) continue
    const start = m.index! + lead!.length
    const note = `${text.slice(0, start)} ${text.slice(m.index! + whole.length)}`.replace(/\s+/g, ' ').trim()
    return { amount, note }
  }
  return null
}

/** "25000", "25.000", "25rb", "1,5jt", "2 juta" → angka rupiah. */
export function parseMoney(raw: string): number | null {
  const s = raw.toLowerCase().replace(/\s+/g, '').replace(/^rp/, '')
  const m = /^([\d.,]+)(rb|ribu|k|jt|juta)?$/.exec(s)
  if (!m) return null
  const mult = m[2] ? (m[2].startsWith('j') ? 1_000_000 : 1_000) : 1
  const base = mult > 1 ? Number(m[1]!.replace(/\./g, '').replace(',', '.')) : parseIdNumber(m[1]!)
  if (base === null || !Number.isFinite(base)) return null
  const n = Math.round(base * mult)
  return n > 0 && n < 1e15 ? n : null
}

/* ---------- Mesin alur ---------- */
async function save(ctx: Ctx, st: FlowState) {
  await ctx.db.from('telegram_pending').upsert({ chat_id: ctx.chatId, user_id: ctx.userId, action: 'alur', payload: st, created_at: new Date().toISOString() })
}
export async function clearFlow(ctx: Ctx) {
  await ctx.db.from('telegram_pending').delete().eq('chat_id', ctx.chatId)
}
export async function loadPending(ctx: Ctx) {
  const { data } = await ctx.db.from('telegram_pending').select('user_id, action, payload, created_at').eq('chat_id', ctx.chatId).maybeSingle()
  if (!data || data.user_id !== ctx.userId || Date.now() - new Date(data.created_at).getTime() > 86_400_000) return null
  return data as { action: string; payload: unknown; created_at: string }
}

function nextStep(flow: Flow, st: FlowState) {
  for (let i = st.s; i < flow.steps.length; i++) {
    const step = flow.steps[i]!
    if (step.key in st.d) continue // sudah terisi (mis. dari perintah cepat)
    if (step.when && !step.when(st)) continue
    return i
  }
  return flow.steps.length // ringkasan & konfirmasi
}

/** Pindah ke langkah berikutnya yang perlu dijawab (lewati yang sudah terisi / tidak relevan). */
async function advance(ctx: Ctx, flow: Flow, st: FlowState, from: number) {
  st.s = nextStep(flow, { ...st, s: from })
  while (st.s < flow.steps.length) {
    const step = flow.steps[st.s]!
    const a = await step.ask(ctx, st)
    if (!a.autoSkip) break
    st.d[step.key] = a.autoSkip.value
    st.s = nextStep(flow, { ...st, s: st.s + 1 })
  }
}

function summary(flow: Flow, st: FlowState) {
  const order = [...flow.steps.map((s) => s.key), ...Object.keys(st.l)]
  const seen = new Set<string>()
  const labelOf = (k: string) => flow.steps.find((s) => s.key === k)?.label ?? ({ project: 'Proyek', goal: 'Target', task: 'Tugas', account: 'Rekening', amount: 'Jumlah', note: 'Keterangan', kind: 'Jenis', body: 'Isi' } as Record<string, string>)[k] ?? k
  // Tabel monospace: label tanpa ikon, titik dua sejajar. Nilai disimpan ter-escape → kembalikan ke teks polos.
  const unesc = (v: string) => v.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  const rows_ = order.filter((k) => !seen.has(k) && (seen.add(k), st.l[k] !== undefined))
    // buang ikon di depan label (bila ada) — jangan potong kata, mis. "Nama kegiatan"
    .map((k) => [labelOf(k).replace(/^[^\p{L}\p{N}]+\s+/u, ''), unesc(st.l[k]!)] as [string, string])
  return rows_.length ? [`<pre>${esc(tableText(rows_, 12))}</pre>`] : []
}

async function render(ctx: Ctx, flow: Flow, st: FlowState, error?: string) {
  const filled = summary(flow, st)
  const head = [`${flow.title}`, ...filled]
  if (st.s >= flow.steps.length) {
    return {
      html: [...head.map((h, i) => (i === 0 ? `<b>${h}</b>` : h)), '', '<b>Sudah benar?</b> Tekan <b>Simpan</b> untuk menyimpan.'].join('\n'),
      kb: [[btn('✅ Simpan', 'w:ok', 'success'), btn('✖️ Batal', 'w:x')]] as Keyboard,
    }
  }
  const step = flow.steps[st.s]!
  const a = await step.ask(ctx, st)
  // Nomor langkah = langkah yang sudah dijawab pengguna + 1 (isian dari perintah cepat / yang dilewati otomatis tidak dihitung).
  const n = (st.q ?? []).filter((k) => k !== step.key).length + 1
  const html = [
    `<b>${head[0]}</b>`, ...head.slice(1), '',
    ...(error ? [`${error}`, ''] : []),
    `<i>Langkah ${n}</i>`,
    `<b>${a.q}</b>`,
    ...(a.hint ? [`<i>${a.hint}</i>`] : a.typing ? ['<i>Ketik jawabanmu di kolom pesan.</i>'] : []),
  ].join('\n')
  const kb: Keyboard = [
    ...(a.choices?.length ? rows(a.choices.map((c) => btn(c.text, `w:${c.v}`)), a.perRow ?? 2) : []),
    [...(a.optional ? [btn('⏭ Lewati', 'w:skip')] : []), btn('✖️ Batal', 'w:x')],
  ]
  return { html, kb }
}

/** Tampilkan formulir: ganti pesan yang tombolnya ditekan, atau kirim pesan baru (setelah jawaban diketik). */
async function show(ctx: Ctx, flow: Flow, st: FlowState, edit: { id: number; photo: boolean } | null, error?: string) {
  const { html, kb } = await render(ctx, flow, st, error)
  if (edit) {
    const r = edit.photo ? await editMessageCaption(ctx.chatId, edit.id, html, kb) : await editMessageKb(ctx.chatId, edit.id, html, kb)
    if (r.ok || /not modified/i.test(r.error)) { st.m = edit.id; st.photo = edit.photo; return }
  }
  if (st.m) await editMessageReplyMarkup(ctx.chatId, st.m, []) // tombol formulir lama dinonaktifkan
  const r = await sendMessageKb(ctx.chatId, html, kb)
  if (r.ok) { st.m = (r.result as { message_id: number }).message_id; st.photo = false }
}

export async function startFlow(ctx: Ctx, name: string, arg: string, edit: { id: number; photo: boolean } | null) {
  const flow = FLOWS[name]
  if (!flow) return
  const init = flow.init ? await flow.init(ctx, arg) : {}
  if ('error' in init) {
    const msg = `${init.error}`
    if (edit) await (edit.photo ? editMessageCaption(ctx.chatId, edit.id, msg, [[btn('🏠 Menu', 'p:home')]]) : editMessageKb(ctx.chatId, edit.id, msg, [[btn('🏠 Menu', 'p:home')]]))
    else await sendMessageKb(ctx.chatId, msg, [[btn('🏠 Menu', 'p:home')]])
    return
  }
  const st: FlowState = { f: name, s: 0, d: init.d ?? {}, l: init.l ?? {} }
  await advance(ctx, flow, st, 0)
  await show(ctx, flow, st, edit)
  await save(ctx, st)
}

/** Lanjutkan alur dengan jawaban (ketikan atau tombol). Mengembalikan false bila tidak ada alur aktif. */
export async function continueFlow(ctx: Ctx, st: FlowState, input: { text?: string; choice?: string }, edit: { id: number; photo: boolean } | null): Promise<boolean> {
  const flow = FLOWS[st.f]
  if (!flow) return false
  if (input.choice === 'x') {
    await clearFlow(ctx)
    const html = `<b>${flow.title}</b>\n\n<i>Dibatalkan — tidak ada yang disimpan.</i>`
    const kb: Keyboard = [[btn('🏠 Menu', 'p:home')]]
    if (edit) await (edit.photo ? editMessageCaption(ctx.chatId, edit.id, html, kb) : editMessageKb(ctx.chatId, edit.id, html, kb))
    else { if (st.m) await editMessageReplyMarkup(ctx.chatId, st.m, []); await sendMessageKb(ctx.chatId, html, kb) }
    return true
  }
  if (st.s >= flow.steps.length) {
    if (input.choice !== 'ok') { await show(ctx, flow, st, edit, 'Tekan <b>Simpan</b> atau <b>Batal</b>.'); return true }
    // Klaim dulu agar tombol Simpan yang ditekan dua kali tidak menyimpan dua kali.
    const { data: gone } = await ctx.db.from('telegram_pending').delete().eq('chat_id', ctx.chatId).eq('action', 'alur').select('chat_id')
    if (!gone?.length) return true
    const res = await flow.commit(ctx, st)
    const html = [`<b>${flow.title}</b>`, ...summary(flow, st), '', ...res.lines].join('\n')
    if (edit) await (edit.photo ? editMessageCaption(ctx.chatId, edit.id, html, res.kb) : editMessageKb(ctx.chatId, edit.id, html, res.kb))
    else await sendMessageKb(ctx.chatId, html, res.kb)
    return true
  }
  const step = flow.steps[st.s]!
  const answered = () => { st.q = [...(st.q ?? []).filter((k) => k !== step.key), step.key] }
  if (input.choice === 'skip') {
    st.d[step.key] = null
    st.l[step.key] = '—'
  } else {
    const a = await step.ask(ctx, st)
    if (input.text !== undefined && !a.typing) { await show(ctx, flow, st, null, 'Pilih salah satu tombol di bawah, ya.'); await save(ctx, st); return true }
    const r = await step.accept(ctx, st, input)
    if ('error' in r) { await show(ctx, flow, st, edit, r.error); await save(ctx, st); return true }
    st.d[step.key] = r.value
    st.l[step.key] = r.label
  }
  answered()
  await advance(ctx, flow, st, st.s + 1)
  await show(ctx, flow, st, edit)
  await save(ctx, st)
  return true
}

export const flowSummaryForText = (text: string) => cut(text.split('\n')[0] ?? '', 60)
