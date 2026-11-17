import 'server-only'
import { aiJson } from '../ai/groq'
import { addDays, todayIn, weekdayMon0, zonedToIso } from '../dates'
import { formatRupiah, formatTime } from '../format'
import { sendChatAction, sendMessageKb } from '../telegram'
import { createTimer, repeatText } from './timers'
import { btn, cut, esc, longDay, type Ctx } from './ui'
import { guessCategory, hhmmIn, minutesLabel, nextOccurrence, whenLabel } from './when'

/*
 * Asisten AI (Groq, kunci milik pengguna): pesan bebas → daftar aksi (tugas, kegiatan, pengingat,
 * pengeluaran, pemasukan, catatan). Tidak ada yang disimpan sebelum pengguna menekan ✅ Simpan semua (BT-04).
 */

export type AiKind = 'tugas' | 'kegiatan' | 'pengingat' | 'pengeluaran' | 'pemasukan' | 'catatan'
export interface AiItem {
  t: AiKind; title: string; at?: string; repeat?: string; amount?: number; minutes?: number; place?: string
  account?: string; accountName?: string; category?: string; categoryName?: string
}
interface RawAction { type?: string; judul?: string; waktu?: string; jam?: string; ulang?: string; hari?: number[]; jumlah?: number; durasi_menit?: number; lokasi?: string }
interface Raw { actions?: RawAction[]; balasan?: string }

const KINDS: AiKind[] = ['tugas', 'kegiatan', 'pengingat', 'pengeluaran', 'pemasukan', 'catatan']
const MAX_ITEMS = 6
const DAY_NAMES = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']

function systemPrompt(tz: string, now: Date): string {
  const today = todayIn(tz, now)
  return [
    'Kamu adalah Rupi, asisten produktivitas berbahasa Indonesia di Telegram.',
    'Ubah pesan pengguna menjadi daftar aksi pencatatan untuk aplikasi Ruang Produktivitas.',
    `Sekarang: ${longDay(today)} (${DAY_NAMES[weekdayMon0(today)]}), pukul ${formatTime(now.toISOString(), tz)}, zona waktu ${tz}. Tanggal hari ini ${today}.`,
    'Aturan:',
    '- type "tugas": pekerjaan yang harus diselesaikan (boleh ada tenggat).',
    '- type "kegiatan": acara pada waktu tertentu (rapat, kajian, janji temu, kelas).',
    '- type "pengingat": pengguna minta diingatkan sesuatu pada waktu tertentu.',
    '- type "pengeluaran" / "pemasukan": uang keluar / masuk. jumlah dalam rupiah, bilangan bulat (20 ribu = 20000, 1,5 jt = 1500000).',
    '- type "catatan": ide, curhat, atau informasi untuk disimpan.',
    '- judul: singkat & jelas, tanpa kata waktu dan nominal. Pertahankan teks berkurung siku seperti [TES QA].',
    '- waktu: "YYYY-MM-DDTHH:MM" hanya bila disebut atau tersirat jelas. "pagi" = 08:00, "siang" = 12:00, "sore" = 16:00, "malam" = 19:00, "jam 2" tanpa keterangan = 14:00. Kosongkan bila tidak disebut — jangan mengarang.',
    '- jam: "HH:MM" (24 jam) setiap kali pengguna menyebut jam, terpisah dari tanggal. WAJIB diisi untuk pengingat berulang yang menyebut jam. Contoh: "jam 7 malam" = "19:00", "jam 9" = "09:00", "jam 2 siang" = "14:00".',
    '- ulang: "harian", "kerja" (Senin–Jumat), atau "mingguan" (isi hari) hanya bila pengguna menyebut "tiap"/"setiap"; selain itu "".',
    '- durasi_menit dan lokasi hanya untuk kegiatan, bila disebut.',
    `- Satu pesan boleh berisi beberapa aksi (maksimal ${MAX_ITEMS}).`,
    '- Bila pesan hanya sapaan, obrolan, atau pertanyaan dan tidak ada yang perlu dicatat: actions kosong, isi "balasan" singkat dan ramah (maks. 2 kalimat). Jangan mengarang data milik pengguna.',
    '',
    'Jawab HANYA dengan satu objek JSON berbentuk:',
    '{"actions":[{"type":"tugas|kegiatan|pengingat|pengeluaran|pemasukan|catatan","judul":"…","waktu":"YYYY-MM-DDTHH:MM atau \"\"","jam":"HH:MM atau \"\"","ulang":"\"\"|harian|kerja|mingguan","hari":[0-6],"jumlah":0,"durasi_menit":0,"lokasi":""}],"balasan":""}',
    'Isi "jumlah" hanya untuk uang, "hari" hanya untuk ulang mingguan, sisanya boleh 0 / "" / [].',
  ].join('\n')
}

/** Kunci AI (Groq) pengguna bila Asisten AI aktif (null = nonaktif / belum diatur). */
export async function aiKey(ctx: Pick<Ctx, 'db' | 'userId'>): Promise<string | null> {
  const { data } = await ctx.db.rpc('ai_get_key', { p_user: ctx.userId })
  return typeof data === 'string' && data ? data : null
}

function normalize(raw: Raw, tz: string, now: Date): AiItem[] {
  const out: AiItem[] = []
  for (const a of (raw.actions ?? []).slice(0, MAX_ITEMS)) {
    let t = KINDS.includes(a.type as AiKind) ? (a.type as AiKind) : null
    if (!t) continue
    const title = String(a.judul ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
    const money = t === 'pengeluaran' || t === 'pemasukan'
    if (!title && !money) continue
    let at = typeof a.waktu === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(a.waktu) ? zonedToIso(a.waktu, tz) ?? undefined : undefined
    // "jam" terpisah: menang atas jam di "waktu" (lebih andal), tanggalnya diambil dari "waktu" / hari ini.
    const jam = typeof a.jam === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(a.jam) ? a.jam : null
    if (jam) {
      const day = typeof a.waktu === 'string' && /^\d{4}-\d{2}-\d{2}/.test(a.waktu) ? a.waktu.slice(0, 10) : todayIn(tz, now)
      at = zonedToIso(`${day}T${jam}`, tz) ?? at
      // jam tanpa tanggal yang sudah lewat → besok (untuk pengingat & kegiatan)
      if (at && !/^\d{4}-\d{2}-\d{2}/.test(a.waktu ?? '') && new Date(at).getTime() <= now.getTime() && t !== 'tugas') at = zonedToIso(`${addDays(day, 1)}T${jam}`, tz) ?? at
    }
    const item: AiItem = { t, title }
    if (money) {
      const amount = Math.round(Number(a.jumlah))
      if (!(amount > 0 && amount < 1e12)) continue
      item.amount = amount
      out.push(item); continue
    }
    if (t === 'pengingat') {
      const days = [...new Set((a.hari ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
      const repeat = a.ulang === 'harian' || a.ulang === 'kerja' ? a.ulang : a.ulang === 'mingguan' && days.length ? `mingguan:${days.join(',')}` : undefined
      if (repeat) {
        at = nextOccurrence(repeat, at ? hhmmIn(at, tz) : '08:00', tz, now) ?? undefined
        if (at) item.repeat = repeat
      }
      // tanpa waktu / sudah lewat → jadikan tugas biasa
      if (!at || new Date(at).getTime() <= now.getTime()) t = 'tugas'
    }
    if (t === 'kegiatan' && !at) t = 'tugas'
    item.t = t
    if (at) item.at = at
    if (t === 'kegiatan') {
      const m = Math.round(Number(a.durasi_menit))
      if (m >= 5 && m <= 1440) item.minutes = m
      const place = String(a.lokasi ?? '').trim().slice(0, 100)
      if (place) item.place = place
    }
    out.push(item)
  }
  return out
}

/** Rekening (yang terakhir dipakai) & kategori tebakan untuk aksi uang. */
async function enrich(ctx: Ctx, items: AiItem[]): Promise<AiItem[]> {
  if (!items.some((i) => i.amount)) return items
  const [{ data: accts }, { data: last }, { data: cats }] = await Promise.all([
    ctx.db.from('financial_accounts').select('id, name').eq('user_id', ctx.userId).eq('is_archived', false).order('name').limit(20),
    ctx.db.from('transactions').select('account_id').eq('user_id', ctx.userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ctx.db.from('transaction_categories').select('id, name, type').eq('user_id', ctx.userId).limit(60),
  ])
  const list = accts ?? []
  const acc = list.find((a) => a.id === last?.account_id) ?? list[0]
  return items.flatMap((i) => {
    if (!i.amount) return [i]
    if (!acc) return [] // belum punya rekening → aksi uang dilewati
    const type = i.t === 'pengeluaran' ? 'pengeluaran' : 'pemasukan'
    const cat = guessCategory(i.title, (cats ?? []).filter((c) => c.type === type))
    return [{ ...i, account: acc.id, accountName: acc.name, ...(cat ? { category: cat.id, categoryName: cat.name } : {}) }]
  })
}

/** Satu baris ringkasan untuk sebuah aksi. */
export function describe(i: AiItem, tz: string): string {
  const when = i.at ? whenLabel(i.at, tz) : ''
  switch (i.t) {
    case 'tugas': return `✅ <b>Tugas</b> — ${cut(i.title, 50)}${when ? ` · ${when}` : ''}`
    case 'kegiatan': return `📅 <b>Kegiatan</b> — ${cut(i.title, 50)} · ${when}${i.minutes ? ` · ${minutesLabel(i.minutes)}` : ''}${i.place ? ` · ${cut(i.place, 30)}` : ''}`
    case 'pengingat': return `🔔 <b>Pengingat</b> — ${cut(i.title, 50)} · ${i.repeat ? `${repeatText(i.repeat, i.at!, tz)}, mulai ${when}` : when}`
    case 'pengeluaran': return `💸 <b>Pengeluaran ${formatRupiah(i.amount!)}</b>${i.title ? ` — ${cut(i.title, 40)}` : ''}${i.categoryName ? ` · ${esc(i.categoryName)}` : ''} · dari ${esc(i.accountName ?? '')}`
    case 'pemasukan': return `💵 <b>Pemasukan ${formatRupiah(i.amount!)}</b>${i.title ? ` — ${cut(i.title, 40)}` : ''}${i.categoryName ? ` · ${esc(i.categoryName)}` : ''} · ke ${esc(i.accountName ?? '')}`
    case 'catatan': return `🗒 <b>Catatan</b> — ${cut(i.title, 60)}`
  }
}

/**
 * Tawarkan hasil pemahaman AI untuk pesan bebas.
 * 'done' = usulan sudah dikirim; selain itu kembali ke mode biasa (dengan balasan / catatan bila ada).
 */
export async function aiOffer(ctx: Ctx, text: string): Promise<'done' | { reply?: string; note?: string }> {
  const key = await aiKey(ctx)
  if (!key) return {}
  void sendChatAction(ctx.chatId, 'typing')
  const now = new Date()
  const r = await aiJson<Raw>(key, { system: systemPrompt(ctx.tz, now), prompt: text.slice(0, 2000) })
  if (!r.ok) return { note: `⚠️ <i>Rupi AI: ${esc(r.error)} Memakai mode biasa.</i>` }
  const items = await enrich(ctx, normalize(r.data, ctx.tz, now))
  if (!items.length) {
    const reply = String(r.data.balasan ?? '').trim().slice(0, 400)
    return reply ? { reply } : {}
  }
  const saved = await ctx.db.from('telegram_pending').upsert({ chat_id: ctx.chatId, user_id: ctx.userId, action: 'ai', payload: { items, text: text.slice(0, 50000) }, created_at: new Date().toISOString() })
  // Usulan tidak bisa disimpan → jangan tampilkan tombol yang tidak akan berfungsi.
  if (saved.error) return { note: '⚠️ <i>Rupi AI belum bisa menyimpan usulan. Memakai mode biasa.</i>' }
  await sendMessageKb(ctx.chatId, [
    `✨ <b>Rupi AI memahami ${items.length > 1 ? `${items.length} hal` : 'ini'}:</b>`,
    '',
    ...items.map((i, n) => `${items.length > 1 ? `${n + 1}. ` : ''}${describe(i, ctx.tz)}`),
    '',
    `<i>${items.length > 1 ? 'Simpan semuanya?' : 'Simpan?'} Belum ada yang tersimpan sebelum kamu menekan tombol.</i>`,
  ].join('\n'), [
    [btn(items.length > 1 ? `✅ Simpan semua (${items.length})` : '✅ Simpan', 'ai:ok', 'success')],
    [btn('✏️ Atur manual', 'ai:man'), btn('✖️ Batal', 'ai:x')],
  ])
  return 'done'
}

/** Simpan semua aksi; kembalikan baris hasil per aksi. */
export async function saveAiItems(ctx: Ctx, items: AiItem[]): Promise<string[]> {
  const today = todayIn(ctx.tz)
  const lines: string[] = []
  for (const i of items.slice(0, MAX_ITEMS)) {
    let ok = false
    try {
      if (i.t === 'tugas') {
        ok = !(await ctx.db.from('tasks').insert({ user_id: ctx.userId, kind: 'tugas', title: i.title, due_at: i.at ?? null, priority: 'sedang' })).error
      } else if (i.t === 'kegiatan') {
        const end = i.minutes ? new Date(new Date(i.at!).getTime() + i.minutes * 60_000).toISOString() : null
        ok = !(await ctx.db.from('tasks').insert({ user_id: ctx.userId, kind: 'kegiatan', title: i.title, start_at: i.at, end_at: end, location: i.place ?? '' })).error
      } else if (i.t === 'pengingat') {
        ok = !('error' in (await createTimer(ctx, 'ingat', i.at!, i.title, null, i.repeat ?? null)))
      } else if (i.t === 'pengeluaran' || i.t === 'pemasukan') {
        ok = !(await ctx.db.from('transactions').insert({ user_id: ctx.userId, account_id: i.account, type: i.t, amount: i.amount, category_id: i.category ?? null, occurred_on: today, note: i.title })).error
      } else if (i.t === 'catatan') {
        const short = i.title.length <= 120
        ok = !(await ctx.db.from('journal_entries').insert({ user_id: ctx.userId, kind: 'catatan', title: short ? i.title : '', content: short ? '' : i.title, entry_date: today, tags: ['telegram', 'ai'] })).error
      }
    } catch { ok = false }
    lines.push(`${ok ? '✓' : '✗'} ${describe(i, ctx.tz)}${ok ? '' : ' <i>(gagal disimpan)</i>'}`)
  }
  await ctx.db.rpc('evaluate_achievements_for', { p_user: ctx.userId })
  return lines
}
