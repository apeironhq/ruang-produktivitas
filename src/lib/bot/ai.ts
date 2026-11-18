import 'server-only'
import { aiJson, type AiConfig, type AiTurn } from '../ai/client'
import { addDays, todayIn, zonedToIso } from '../dates'
import { formatRupiah, formatTime } from '../format'
import { sendChatAction, sendMessage, sendMessageKb } from '../telegram'
import { dataSnapshot } from './aiContext'
import { createTimer, repeatText } from './timers'
import { btn, cut, esc, longDay, type Ctx } from './ui'
import { guessCategory, hhmmIn, minutesLabel, nextOccurrence, whenLabel } from './when'

/*
 * Asisten AI (Groq atau endpoint kustom seperti 9router, kunci milik pengguna): pesan bebas → daftar aksi (tugas, kegiatan, pengingat,
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

function systemPrompt(ctx: Pick<Ctx, 'tz' | 'name'>, now: Date, data: string | null, shared: boolean): string {
  const today = todayIn(ctx.tz, now)
  const name = ctx.name?.trim().split(/\s+/)[0] ?? ''
  return [
    'Kamu adalah Rupi, asisten produktivitas di bot Telegram aplikasi Ruang Produktivitas.',
    `Gaya: bahasa Indonesia santai dan hangat seperti teman yang rapi, ringkas (biasanya 1–4 kalimat), emoji secukupnya.${name ? ` Nama pengguna: ${name}.` : ''}`,
    'Jangan menyebut dirimu model / buatan perusahaan AI tertentu; kamu cukup "Rupi".',
    `Sekarang: ${longDay(today)}, pukul ${formatTime(now.toISOString(), ctx.tz)}, zona waktu ${ctx.tz}. Tanggal hari ini ${today}.`,
    '',
    'Kemampuanmu:',
    '- Mencatat dari pesan bebas: tugas, kegiatan, pengingat (termasuk berulang), pengeluaran / pemasukan, dan catatan. Semua usulan dikonfirmasi pengguna dulu lewat tombol.',
    '- Menjawab pertanyaan tentang agenda, tugas, target, kebiasaan, dan keuangan pengguna — HANYA dari DATA PENGGUNA di bawah.',
    '- Mengobrol ringan, memberi semangat, dan saran produktivitas singkat yang praktis.',
    '- Fitur lain lewat perintah: /fokus (pomodoro), /timer, /kalender, /tugas, /target, /keuangan, /kebiasaan, /ringkasan, /menu. Sarankan perintah itu bila cocok.',
    '- Kamu tidak bisa mengubah / menghapus data yang sudah tersimpan; arahkan ke /tugas atau aplikasi web.',
    '',
    'Kapan membuat actions:',
    '- Hanya bila pengguna jelas ingin mencatat, menjadwalkan, diingatkan, atau mencatat uang.',
    '- Pertanyaan ("tugasku hari ini apa?", "pengeluaranku berapa?"), sapaan, curhat, atau obrolan → actions kosong, jawab di "balasan".',
    '- Bila pengguna merujuk pesan sebelumnya ("yang tadi", "jadikan jam 8 aja", "catat itu"), pakai riwayat percakapan. Untuk mengubah usulan yang belum disimpan, buat ulang aksinya lengkap dengan perubahan.',
    '',
    'Isi "balasan" (selalu diisi, teks biasa tanpa Markdown / HTML):',
    '- Bila ada actions: satu kalimat pengantar singkat, jangan mengulang daftar aksinya.',
    '- Bila tidak ada actions: jawaban lengkap; untuk daftar pakai baris baru diawali "• " (maks. 8 baris).',
    '- Jangan mengarang data pengguna. Bila DATA tidak memuat jawabannya, katakan terus terang dan sarankan perintah yang relevan.',
    '',
    'Aturan actions:',
    '- type "tugas": pekerjaan yang harus diselesaikan (boleh ada tenggat).',
    '- type "kegiatan": acara pada waktu tertentu (rapat, kajian, janji temu, kelas).',
    '- type "pengingat": pengguna minta diingatkan sesuatu pada waktu tertentu.',
    '- type "pengeluaran" / "pemasukan": uang keluar / masuk. jumlah dalam rupiah, bilangan bulat (20 ribu = 20000, 1,5 jt = 1500000).',
    '- type "catatan": ide, curhat, atau informasi yang pengguna minta disimpan.',
    '- judul: singkat & jelas, tanpa kata waktu dan nominal. Pertahankan teks berkurung siku seperti [TES QA].',
    '- waktu: "YYYY-MM-DDTHH:MM" hanya bila disebut atau tersirat jelas. "pagi" = 08:00, "siang" = 12:00, "sore" = 16:00, "malam" = 19:00, "jam 2" tanpa keterangan = 14:00. Kosongkan bila tidak disebut — jangan mengarang.',
    '- jam: "HH:MM" (24 jam) setiap kali pengguna menyebut jam, terpisah dari tanggal. WAJIB diisi untuk pengingat berulang yang menyebut jam. Contoh: "jam 7 malam" = "19:00", "jam 9" = "09:00", "jam 2 siang" = "14:00".',
    '- ulang: "harian", "kerja" (Senin–Jumat), atau "mingguan" (isi hari) hanya bila pengguna menyebut "tiap"/"setiap"; selain itu "".',
    '- durasi_menit dan lokasi hanya untuk kegiatan, bila disebut.',
    `- Satu pesan boleh berisi beberapa aksi (maksimal ${MAX_ITEMS}).`,
    '',
    data
      ? `DATA PENGGUNA (ringkasan terbaru dari aplikasi):\n${data}`
      : shared
        ? 'DATA PENGGUNA: sedang tidak bisa dimuat. Untuk pertanyaan tentang data, sarankan /menu, /tugas, /kalender, atau /keuangan.'
        : 'DATA PENGGUNA: tidak dibagikan (pengguna mematikan izinnya di Pengaturan). Untuk pertanyaan tentang data, sarankan /menu, /tugas, /kalender, atau /keuangan.',
    '',
    'Jawab HANYA dengan satu objek JSON berbentuk:',
    '{"actions":[{"type":"tugas|kegiatan|pengingat|pengeluaran|pemasukan|catatan","judul":"…","waktu":"YYYY-MM-DDTHH:MM atau \"\"","jam":"HH:MM atau \"\"","ulang":"\"\"|harian|kerja|mingguan","hari":[0-6],"jumlah":0,"durasi_menit":0,"lokasi":""}],"balasan":""}',
    'Isi "jumlah" hanya untuk uang, "hari" hanya untuk ulang mingguan, sisanya boleh 0 / "" / [].',
  ].join('\n')
}

/** Konfigurasi AI pengguna bila Asisten AI aktif (null = nonaktif / belum diatur). */
export async function aiConfig(ctx: Pick<Ctx, 'db' | 'userId'>): Promise<(AiConfig & { shareData: boolean }) | null> {
  const { data } = await ctx.db.rpc('ai_get_config', { p_user: ctx.userId })
  const row = (Array.isArray(data) ? data[0] : data) as { key?: string; base_url?: string; model?: string; share_data?: boolean } | null | undefined
  if (!row?.key) return null
  const shareData = row.share_data !== false
  return row.base_url ? { key: row.key, baseUrl: row.base_url, model: row.model ?? '', shareData } : { key: row.key, shareData }
}

/* ---- Ingatan percakapan: beberapa pesan terakhir (30 menit) per chat, disimpan maks. ±1 hari. ---- */
const HISTORY_TURNS = 8
const HISTORY_MINUTES = 30

async function loadHistory(ctx: Ctx): Promise<AiTurn[]> {
  const since = new Date(Date.now() - HISTORY_MINUTES * 60_000).toISOString()
  const { data } = await ctx.db.from('ai_chat_turns').select('role, content').eq('chat_id', ctx.chatId).eq('user_id', ctx.userId)
    .gte('created_at', since).order('created_at', { ascending: false }).limit(HISTORY_TURNS)
  return ((data ?? []) as AiTurn[]).reverse()
}

/** Catat satu giliran percakapan (diabaikan bila gagal — ingatan hanya pelengkap). */
export async function rememberTurns(ctx: Pick<Ctx, 'db' | 'userId' | 'chatId'>, turns: AiTurn[]) {
  const rows = turns.filter((t) => t.content.trim()).map((t) => ({ user_id: ctx.userId, chat_id: ctx.chatId, role: t.role, content: t.content.slice(0, 4000) }))
  if (!rows.length) return
  await ctx.db.from('ai_chat_turns').insert(rows)
  await ctx.db.from('ai_chat_turns').delete().eq('chat_id', ctx.chatId).lt('created_at', new Date(Date.now() - 86_400_000).toISOString())
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

/** Balasan AI → teks bersih (tanpa token sisa model / Markdown tebal). */
function cleanReply(s: unknown): string {
  return String(s ?? '')
    .replace(/<\|[^|>]*\|>/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1500)
}

/** Ringkasan usulan dalam teks biasa (untuk ingatan percakapan). */
const plainItems = (items: AiItem[], tz: string) => items.map((i) => describe(i, tz).replace(/<[^>]+>/g, '')).join('; ')

/**
 * Pesan bebas → Rupi AI.
 *  - Ada yang perlu dicatat → usulan dengan tombol ✅ Simpan (belum disimpan sebelum ditekan).
 *  - Obrolan / pertanyaan → dibalas langsung seperti mengobrol (tanpa "mau disimpan sebagai apa?").
 * 'done' = sudah dibalas; selain itu kembali ke mode biasa (dengan catatan galat bila ada).
 */
export async function aiOffer(ctx: Ctx, text: string): Promise<'done' | { reply?: string; note?: string }> {
  const cfg = await aiConfig(ctx)
  if (!cfg) return {}
  void sendChatAction(ctx.chatId, 'typing')
  const now = new Date()
  const prompt = text.slice(0, 2000)
  const [history, data] = await Promise.all([
    loadHistory(ctx).catch(() => [] as AiTurn[]),
    cfg.shareData ? dataSnapshot(ctx).catch(() => null) : Promise.resolve(null),
  ])
  const r = await aiJson<Raw>(cfg, { system: systemPrompt(ctx, now, data, cfg.shareData), prompt, history })
  if (!r.ok) return { note: `⚠️ <i>Rupi AI: ${esc(r.error)} Memakai mode biasa.</i>` }
  const reply = cleanReply(r.data.balasan)
  const items = await enrich(ctx, normalize(r.data, ctx.tz, now))

  if (!items.length) {
    // Mode ngobrol: cukup balas.
    if (!reply) return {}
    await sendMessage(ctx.chatId, `✨ ${esc(reply)}`)
    await rememberTurns(ctx, [{ role: 'user', content: prompt }, { role: 'assistant', content: reply }]).catch(() => {})
    return 'done'
  }

  const saved = await ctx.db.from('telegram_pending').upsert({ chat_id: ctx.chatId, user_id: ctx.userId, action: 'ai', payload: { items, text: text.slice(0, 50000) }, created_at: new Date().toISOString() })
  // Usulan tidak bisa disimpan → jangan tampilkan tombol yang tidak akan berfungsi.
  if (saved.error) return { note: '⚠️ <i>Rupi AI belum bisa menyimpan usulan. Memakai mode biasa.</i>' }
  const sent = await sendMessageKb(ctx.chatId, [
    reply ? `✨ ${esc(reply)}` : `✨ <b>Rupi AI memahami ${items.length > 1 ? `${items.length} hal` : 'ini'}:</b>`,
    '',
    ...items.map((i, n) => `${items.length > 1 ? `${n + 1}. ` : ''}${describe(i, ctx.tz)}`),
    '',
    `<i>${items.length > 1 ? 'Simpan semuanya?' : 'Simpan?'} Belum ada yang tersimpan sebelum kamu menekan tombol.</i>`,
  ].join('\n'), [
    [btn(items.length > 1 ? `✅ Simpan semua (${items.length})` : '✅ Simpan', 'ai:ok', 'success')],
    [btn('✏️ Atur manual', 'ai:man'), btn('✖️ Batal', 'ai:x')],
  ])
  // Tandai usulan dengan nomor pesannya: tombol di usulan lama tidak boleh bekerja atas usulan baru.
  const mid = sent.ok ? (sent.result as { message_id?: number }).message_id : undefined
  if (mid) await ctx.db.from('telegram_pending').update({ payload: { items, text: text.slice(0, 50000), mid } }).eq('chat_id', ctx.chatId).eq('action', 'ai')
  await rememberTurns(ctx, [
    { role: 'user', content: prompt },
    { role: 'assistant', content: `${reply ? `${reply}\n` : ''}(Usulan belum disimpan: ${plainItems(items, ctx.tz)})` },
  ]).catch(() => {})
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
