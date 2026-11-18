import 'server-only'
import { aiJson, type AiConfig, type AiTurn } from '../ai/client'
import { addDays, todayIn, zonedToIso } from '../dates'
import { formatRupiah, formatTime } from '../format'
import { sendChatAction, sendMessage, sendMessageKb } from '../telegram'
import { dataSnapshot } from './aiContext'
import { describeOp, normalizeOps, type AiOp } from './aiOps'
import { createTimer, repeatText } from './timers'
import { btn, cut, esc, longDay, type Ctx } from './ui'
import { guessCategory, hhmmIn, minutesLabel, nextOccurrence, whenLabel } from './when'

/*
 * Asisten AI (Groq atau endpoint kustom seperti 9router, kunci milik pengguna): pesan bebas → obrolan, jawaban dari data,
 * data baru (tugas, kegiatan, pengingat, pengeluaran, pemasukan, catatan) dan perubahan atas data yang sudah ada (aiOps.ts).
 * Tidak ada yang disimpan / diubah sebelum pengguna menekan ✅ Simpan (BT-04).
 */

export type AiKind = 'tugas' | 'kegiatan' | 'pengingat' | 'pengeluaran' | 'pemasukan' | 'catatan'
export interface AiItem {
  t: AiKind; title: string; at?: string; repeat?: string; amount?: number; minutes?: number; place?: string
  account?: string; accountName?: string; category?: string; categoryName?: string
}
interface RawAction { type?: string; judul?: string; waktu?: string; jam?: string; ulang?: string; hari?: number[]; jumlah?: number; durasi_menit?: number; lokasi?: string }
interface Raw { actions?: RawAction[]; ops?: unknown[]; balasan?: string }

/** Pesan saat Rupi AI gagal menjawab — ramah, tanpa nama / alamat penyedia. */
const AI_FAIL: Record<string, string> = {
  kuota: 'Rupi AI lagi kena batas pemakaian, coba lagi sebentar ya.',
  jaringan: 'Rupi AI lagi susah tersambung, coba kirim lagi sebentar ya.',
  kunci: 'Kunci AI-mu ditolak — cek lagi di Pengaturan web.',
  lain: 'Rupi AI lagi kesulitan menjawab pesan ini, coba kirim lagi ya.',
}

const KINDS: AiKind[] = ['tugas', 'kegiatan', 'pengingat', 'pengeluaran', 'pemasukan', 'catatan']
const MAX_ITEMS = 6

function systemPrompt(ctx: Pick<Ctx, 'tz' | 'name'>, now: Date, data: string | null, shared: boolean): string {
  const today = todayIn(ctx.tz, now)
  const name = ctx.name?.trim().split(/\s+/)[0] ?? ''
  return [
    'Kamu adalah Rupi, asisten produktivitas di bot Telegram aplikasi Ruang Produktivitas.',
    `Gaya: bahasa Indonesia yang sopan, lugas, dan profesional seperti asisten kerja. Langsung ke inti, tanpa basa-basi atau sapaan berlebihan. Sebut nama pengguna hanya saat membalas sapaan; selebihnya pakai "Anda" atau tanpa sebutan (jangan "pengeluaran <nama>"). Hampir tanpa emoji: paling banyak satu, dan hanya di judul bagian.${name ? ` Nama pengguna: ${name}.` : ''}`,
    'Panjang jawaban: sapaan atau pertanyaan singkat cukup 1–2 kalimat; minta saran atau evaluasi boleh lebih panjang (sampai ±10 kalimat, atau poin-poin).',
    'Jawab hanya yang ditanya. Jangan mengulang agenda, jadwal, atau data yang tidak ditanyakan, dan jangan menambahkan ajakan atau basa-basi di luar konteks.',
    'Jangan menyebut dirimu model / buatan perusahaan AI tertentu; kamu cukup "Rupi".',
    `Sekarang: ${longDay(today)}, pukul ${formatTime(now.toISOString(), ctx.tz)}, zona waktu ${ctx.tz}. Tanggal hari ini ${today}.`,
    '',
    'Kemampuanmu:',
    '- Mencatat dari pesan bebas: tugas, kegiatan, pengingat (termasuk berulang), pengeluaran / pemasukan, dan catatan. Semua usulan dikonfirmasi pengguna dulu lewat tombol.',
    '- Membaca SELURUH data dashboard pengguna (DATA PENGGUNA di bawah) dan menjawab pertanyaan tentangnya — hanya dari DATA itu.',
    '- Mengubah data yang sudah ada lewat "ops": ubah / selesaikan / batalkan / hapus tugas & kegiatan, ubah / hapus transaksi, transfer antar rekening, atur anggaran, progres / buat / ubah target, catat sesi belajar, check-in / buat / arsipkan kebiasaan, ubah proyek, ubah / hapus jurnal, batalkan pengingat.',
    '- Menjawab pertanyaan umum dan memberi saran yang konkret, bertahap, dan bisa langsung dilakukan.',
    '- Saat memberi saran tentang hidup pengguna (boros, menunda, susah fokus, target meleset), kaitkan dengan angka / nama dari DATA: sebut kategori pengeluaran terbesar, tugas yang terlambat, kebiasaan yang putus, dsb. Bila relevan, tutup dengan satu tawaran bantuan singkat (mis. "Perlu saya buatkan pengingat?").',
    '- Untuk kesehatan, hukum, atau investasi: beri gambaran umum yang aman saja dan sarankan bertanya ke ahlinya; jangan memberi diagnosis atau rekomendasi produk investasi tertentu.',
    '- Fitur lain lewat perintah: /fokus (pomodoro), /timer, /kalender, /tugas, /target, /keuangan, /kebiasaan, /ringkasan, /menu. Sarankan perintah itu bila cocok.',
    '',
    'Kapan membuat actions:',
    '- Hanya bila pengguna jelas ingin mencatat, menjadwalkan, diingatkan, atau mencatat uang.',
    '- Pertanyaan ("tugasku hari ini apa?", "pengeluaranku berapa?"), minta saran, sapaan, curhat, atau obrolan → actions kosong, jawab di "balasan". Jangan membuat aksi hanya karena kamu menyarankannya — tawarkan dulu.',
    '- Bila pengguna merujuk pesan sebelumnya ("yang tadi", "jadikan jam 8 aja", "catat itu"), pakai riwayat percakapan. Untuk mengubah usulan yang belum disimpan, buat ulang aksinya lengkap dengan perubahan.',
    '',
    'Isi "balasan" (selalu diisi):',
    '- Bila ada actions: satu kalimat pengantar singkat, jangan mengulang daftar aksinya.',
    '- Bila tidak ada actions: jawaban lengkap.',
    '- Format rapi untuk Telegram: jawaban singkat cukup 1 paragraf tanpa judul. Jawaban panjang dibagi menjadi beberapa bagian (maks. 4); tiap bagian diawali judul singkat di baris sendiri yang diapit **…** (tanpa emoji, atau paling banyak satu emoji), lalu isinya. Poin diawali "• ", langkah diawali "1.", "2."; tebalkan hanya angka / nama terpenting (maks. 1–2 per baris). Pisahkan bagian dengan satu baris kosong. Jangan pakai tabel, tanda #, garis pemisah, atau HTML.',
    '- Angka: kutip apa adanya angka yang sudah ada di DATA (total, rata-rata per hari, sisa / lebih anggaran, saldo, persentase) — jangan menghitung ulang. Bila perlu hitungan baru (mis. perkiraan saldo habis), tulis rumusnya singkat dari angka DATA yang benar (mis. saldo ÷ rata-rata per hari), bukan dari total bulanan.',
    '- Jangan menyimpulkan pola, kebiasaan, atau fakta tentang pengguna yang tidak tertulis di DATA atau percakapan (mis. jam produktifnya).',
    '- Jangan mengarang data pengguna. Bila DATA tidak memuat jawabannya (mis. transaksi yang lebih lama), katakan terus terang dan sarankan perintah / halaman web yang relevan.',
    '- Jangan tampilkan kode item (T1, X3, G2, …) di "balasan"; sebut judul / nominalnya.',
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
    'Aturan ops (perubahan atas data yang SUDAH ada):',
    '- Buat ops hanya bila pengguna jelas meminta perubahan itu; hapus hanya bila diminta eksplisit. Semua ops tetap dikonfirmasi pengguna lewat tombol.',
    '- "ref" WAJIB kode item persis dari DATA (mis. "T3"); jangan mengarang kode. Bila item yang dimaksud tidak jelas atau ada beberapa yang cocok, jangan buat ops — tanyakan di "balasan" dengan menyebut pilihannya.',
    '- Isi hanya kolom yang berubah. Rekening & kategori ditulis dengan namanya persis seperti di DATA.',
    '- Data baru (tugas, kegiatan, pengingat, pengeluaran, pemasukan, catatan) tetap memakai "actions"; target baru, kebiasaan baru, transfer, dan anggaran memakai "ops".',
    'Bentuk ops yang tersedia:',
    '{"op":"ubah_tugas","ref":"T1","judul":"","waktu":"YYYY-MM-DDTHH:MM","jam":"HH:MM","prioritas":"rendah|sedang|tinggi","lokasi":"","durasi_menit":0}',
    '{"op":"status_tugas","ref":"T1","status":"selesai|dikerjakan|belum|tertunda|dibatalkan"}',
    '{"op":"hapus_tugas","ref":"T1"}',
    '{"op":"ubah_transaksi","ref":"X1","jumlah":0,"kategori":"","rekening":"","catatan":"","tanggal":"YYYY-MM-DD"}',
    '{"op":"hapus_transaksi","ref":"X1"}',
    '{"op":"transfer","dari":"nama rekening","ke":"nama rekening","jumlah":0,"catatan":""}',
    '{"op":"anggaran","kategori":"nama kategori pengeluaran","jumlah":0}  (batas pengeluaran bulan ini)',
    '{"op":"progres_target","ref":"G1","nilai":0,"catatan":""}  (tambahan progres, boleh negatif; hanya target tanpa "progres otomatis")',
    '{"op":"tambah_target","judul":"","target":0,"satuan":"","jenis":"rupiah|jumlah|durasi|persentase","tenggat":"YYYY-MM-DD"}',
    '{"op":"ubah_target","ref":"G1","judul":"","target":0,"tenggat":"YYYY-MM-DD","status":"aktif|tercapai|arsip"}',
    '{"op":"sesi_belajar","ref":"B1","menit":0,"materi":""}',
    '{"op":"checkin","ref":"H1"}',
    '{"op":"tambah_kebiasaan","nama":"","frekuensi":"harian|mingguan","kali_per_minggu":0}',
    '{"op":"arsip_kebiasaan","ref":"H1"}',
    '{"op":"ubah_proyek","ref":"P1","status":"rencana|aktif|selesai|ditunda|arsip","tenggat":"YYYY-MM-DD"}',
    '{"op":"ubah_jurnal","ref":"J1","judul":"","isi":""}',
    '{"op":"hapus_jurnal","ref":"J1"}',
    '{"op":"batal_pengingat","ref":"R1"}',
    '',
    data
      ? `DATA PENGGUNA (seluruh dashboard, terbaru; kode di awal baris dipakai untuk "ref"):\n${data}`
      : shared
        ? 'DATA PENGGUNA: sedang tidak bisa dimuat — jangan buat ops. Untuk pertanyaan tentang data, sarankan /menu, /tugas, /kalender, atau /keuangan.'
        : 'DATA PENGGUNA: tidak dibagikan (pengguna mematikan izinnya di Pengaturan > Asisten AI) — jangan buat ops; bila pengguna minta mengubah data, sarankan menyalakan izin itu.',
    '',
    'Jawab HANYA dengan satu objek JSON berbentuk:',
    '{"actions":[{"type":"tugas|kegiatan|pengingat|pengeluaran|pemasukan|catatan","judul":"…","waktu":"YYYY-MM-DDTHH:MM atau \"\"","jam":"HH:MM atau \"\"","ulang":"\"\"|harian|kerja|mingguan","hari":[0-6],"jumlah":0,"durasi_menit":0,"lokasi":""}],"ops":[{"op":"…","ref":"…"}],"balasan":""}',
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

/** Balasan AI → teks bersih (tanpa token sisa model); **tebal** dipertahankan untuk formatReply. */
function cleanReply(s: unknown): string {
  return String(s ?? '')
    .replace(/<\|[^|>]*\|>/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 3500)
}

/**
 * Teks balasan → HTML Telegram yang rapi dan aman: semua di-escape dulu, lalu hanya **tebal** yang
 * menjadi <b>. Judul Markdown (#), butir "-" / "*", dan baris judul pendek berakhiran ":" dirapikan;
 * judul bagian diberi jarak satu baris kosong di atasnya.
 */
export function formatReply(s: string): string {
  const out: string[] = []
  for (const raw of s.split('\n')) {
    let line = raw.trim()
    if (/^([-*_=])\1{2,}$/.test(line)) continue // garis pemisah
    const md = /^#{1,6}\s+/.test(line)
    line = line.replace(/^#{1,6}\s+/, '').replace(/^[-*]\s+/, '• ').replace(/^•(?=\S)/, '• ')
    let html = esc(line).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*\*/g, '')
    // Judul bagian: Markdown #, satu baris tebal pendek, baris pendek berakhiran ":", atau baris pendek
    // yang diawali emoji tanpa tanda baca akhir (model kadang lupa menulis **).
    const emojiTitle = /^\p{Extended_Pictographic}/u.test(line) && line.length <= 50 && !/[.!?,]$/.test(line)
    const heading = md || emojiTitle || /^<b>[^<]{1,60}<\/b>:?$/.test(html) || (/^[^•\d<].{0,48}:$/.test(line) && !line.includes('**'))
    if (heading && !/^<b>.*<\/b>:?$/.test(html)) html = `<b>${html}</b>`
    if (heading) html = html.replace(/:(<\/b>)?$/, '$1').replace(/<\/b>:$/, '</b>')
    if (heading && out.length && out[out.length - 1] !== '') out.push('')
    out.push(html)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Ringkasan usulan dalam teks biasa (untuk ingatan percakapan). */
const plainItems = (items: AiItem[], tz: string) => items.map((i) => describe(i, tz).replace(/<[^>]+>/g, '')).join('; ')

/**
 * Pesan bebas → Rupi AI.
 *  - Ada yang perlu dicatat → usulan dengan tombol ✅ Simpan (belum disimpan sebelum ditekan).
 *  - Obrolan / pertanyaan → dibalas langsung seperti mengobrol (tanpa "mau disimpan sebagai apa?").
 * 'done' = sudah dibalas; selain itu kembali ke mode biasa (dengan catatan galat bila ada).
 */
export async function aiOffer(ctx: Ctx, text: string): Promise<'done' | { reply?: string; note?: string; fail?: string }> {
  const cfg = await aiConfig(ctx)
  if (!cfg) return {}
  void sendChatAction(ctx.chatId, 'typing')
  const now = new Date()
  const prompt = text.slice(0, 2000)
  const [history, snap] = await Promise.all([
    loadHistory(ctx).catch(() => [] as AiTurn[]),
    cfg.shareData ? dataSnapshot(ctx).catch(() => null) : Promise.resolve(null),
  ])
  const data = snap?.text ?? null
  // Status "mengetik…" Telegram hilang ±5 detik; ulangi selama AI berpikir (model gratis bisa 15–25 detik).
  const typing = setInterval(() => void sendChatAction(ctx.chatId, 'typing'), 4500)
  let r = await aiJson<Raw>(cfg, { system: systemPrompt(ctx, now, data, cfg.shareData), prompt, history, maxTokens: 3000 })
  // Gagal (selain kunci ditolak) → coba sekali lagi lebih ringan: tanpa riwayat, data diringkas, jawaban lebih pendek.
  if (!r.ok && r.kind !== 'kunci') {
    r = await aiJson<Raw>(cfg, { system: systemPrompt(ctx, now, data ? data.slice(0, 2500) : null, cfg.shareData), prompt, maxTokens: 1500 })
  }
  clearInterval(typing)
  if (!r.ok) {
    const fail = AI_FAIL[r.kind] ?? AI_FAIL.lain
    return { fail, note: `⚠️ <i>${fail} Sementara pakai mode biasa:</i>` }
  }
  const reply = cleanReply(r.data.balasan)
  const items = await enrich(ctx, normalize(r.data, ctx.tz, now))
  const ops: AiOp[] = snap ? normalizeOps(r.data.ops, snap, ctx.tz) : []

  if (!items.length && !ops.length) {
    // Mode ngobrol: cukup balas.
    if (!reply) return {}
    await sendMessage(ctx.chatId, `✨ ${formatReply(reply)}`)
    await rememberTurns(ctx, [{ role: 'user', content: prompt }, { role: 'assistant', content: reply.replace(/\*\*/g, '') }]).catch(() => {})
    return 'done'
  }

  const n = items.length + ops.length
  const saved = await ctx.db.from('telegram_pending').upsert({ chat_id: ctx.chatId, user_id: ctx.userId, action: 'ai', payload: { items, ops, text: text.slice(0, 50000) }, created_at: new Date().toISOString() })
  // Usulan tidak bisa disimpan → jangan tampilkan tombol yang tidak akan berfungsi.
  if (saved.error) return { note: '⚠️ <i>Rupi AI belum bisa menyimpan usulan. Memakai mode biasa.</i>' }
  const sent = await sendMessageKb(ctx.chatId, [
    reply ? `✨ ${formatReply(reply)}` : `✨ <b>Rupi AI memahami ${n > 1 ? `${n} hal` : 'ini'}:</b>`,
    '',
    ...[...items.map((i) => describe(i, ctx.tz)), ...ops.map((o) => describeOp(o, ctx.tz))].map((line, k) => `${n > 1 ? `${k + 1}. ` : ''}${line}`),
    '',
    `<i>${n > 1 ? 'Jalankan semuanya?' : 'Jalankan?'} Belum ada yang tersimpan / berubah sebelum kamu menekan tombol.</i>`,
  ].join('\n'), [
    [btn(n > 1 ? `✅ Simpan semua (${n})` : '✅ Simpan', 'ai:ok', 'success')],
    // "Atur manual" hanya untuk data baru (isian biasa tidak bisa mengubah data lama).
    ops.length ? [btn('✖️ Batal', 'ai:x')] : [btn('✏️ Atur manual', 'ai:man'), btn('✖️ Batal', 'ai:x')],
  ])
  // Tandai usulan dengan nomor pesannya: tombol di usulan lama tidak boleh bekerja atas usulan baru.
  const mid = sent.ok ? (sent.result as { message_id?: number }).message_id : undefined
  if (mid) await ctx.db.from('telegram_pending').update({ payload: { items, ops, text: text.slice(0, 50000), mid } }).eq('chat_id', ctx.chatId).eq('action', 'ai')
  const plain = [plainItems(items, ctx.tz), ops.map((o) => describeOp(o, ctx.tz).replace(/<[^>]+>/g, '')).join('; ')].filter(Boolean).join('; ')
  await rememberTurns(ctx, [
    { role: 'user', content: prompt },
    { role: 'assistant', content: `${reply ? `${reply}\n` : ''}(Usulan belum disimpan: ${plain})` },
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
