import 'server-only'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_TZ, isValidTimeZone, startOfDayIso, todayIn, addDays, zonedToIso } from './dates'
import { formatDuration, formatNumber, formatRupiah, formatShort, formatTime } from './format'
import { GOAL_COLUMNS, mergeProgress } from './queries'
import type { Goal, GoalProgressRow } from './types'
import { answerCallback, editMessage, editMessageCaption, editMessageKb, esc, sendMessage, sendMessageKb, sendPhoto, type Keyboard } from './telegram'

/* ---------- Tipe minimal update Telegram ---------- */
interface TgUser { id: number; username?: string; first_name?: string }
interface TgMessage { message_id: number; chat: { id: number; type: string }; from?: TgUser; text?: string; photo?: unknown[] }
interface TgCallback { id: string; from: TgUser; data?: string; message?: TgMessage }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback }

interface Ctx { db: SupabaseClient; chatId: number; userId: string; tz: string; name: string }

const OPEN = ['belum', 'dikerjakan', 'tertunda']
/** Alamat publik aplikasi: NEXT_PUBLIC_SITE_URL bila https, kalau tidak alamat produksi dari Vercel. */
export const siteUrl = () => {
  const env = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')
  if (env.startsWith('https://')) return env
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return prod ? `https://${prod}` : env
}
const httpsSite = () => siteUrl().startsWith('https://')
const appLink = (path: string, label = 'Buka di aplikasi') => (siteUrl() ? `\n\n<a href="${siteUrl()}${path}">${label}</a>` : '')

/** Garis pemisah antarbagian pesan (Telegram tidak punya garis horizontal). */
const SEP = '━━━━━━━━━━━━━━'

const HELP = [
  '📖 <b>Perintah Rupi</b>',
  SEP,
  '/menu — ringkasan hari ini & menu utama',
  '/tugas — tugas & kegiatan',
  '/tambah <i>judul [besok] [09.00]</i> — tambah tugas',
  '/catat <i>isi</i> — simpan catatan cepat',
  '/belajar <i>menit bidang materi</i> — catat sesi belajar',
  '/target — progres target aktif',
  '/keuangan — ringkasan keuangan bulan ini',
  '/ringkasan — perkembangan 7 hari',
  '/pengingat — pengingat 24 jam ke depan',
  '/putus — putuskan bot dari akun',
  SEP,
  '<i>Pesan biasa tanpa perintah akan ditawarkan untuk disimpan sebagai catatan.</i>',
].join('\n')

/** Proses satu update. Mengembalikan status untuk telegram_updates. */
export async function handleUpdate(db: SupabaseClient, u: TgUpdate): Promise<'selesai' | 'diabaikan'> {
  if (u.callback_query) return handleCallback(db, u.callback_query)
  const m = u.message
  if (!m?.text || !m.from) return 'diabaikan'
  // Hanya chat pribadi — di grup data pribadi bisa terbaca orang lain.
  if (m.chat.type !== 'private') return 'diabaikan'
  const chatId = m.chat.id
  const text = m.text.trim()
  const cmd = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text)
  const name = cmd?.[1]?.toLowerCase() ?? ''
  const arg = (cmd?.[2] ?? '').trim()

  if (name === 'start' || name === 'mulai') {
    if (arg) return linkAccount(db, chatId, m.from, arg)
  }

  const ctx = await loadCtx(db, m.from.id, chatId)
  if (!ctx) {
    // UJ-08: akun Telegram yang belum ditautkan tidak bisa membaca/menulis data apa pun.
    await sendMessage(chatId, [
      '👋 <b>Halo! Aku Rupi.</b>',
      'Asisten produktivitas pribadimu dari Ruang Produktivitas.',
      SEP,
      'Bot ini belum ditautkan ke akunmu. Caranya:',
      '1. Buka <b>Pengaturan → Bot Telegram</b> di aplikasi',
      '2. Tekan <b>Buat kode tautan</b>',
      '3. Kirim ke sini: <code>/mulai KODE</code>',
    ].join('\n') + appLink('/pengaturan', '🌐 Buka Pengaturan'))
    return 'selesai'
  }

  switch (cmd ? name : '') {
    case 'start': case 'mulai': case 'menu': await sendDashboard(ctx); break
    case 'bantuan': case 'help': await sendMessageKb(chatId, HELP, backKb()); break
    case 'tugas': await sendPanel(ctx, await tasksPanel(ctx)); break
    case 'target': await sendPanel(ctx, await goalsPanel(ctx)); break
    case 'keuangan': await sendPanel(ctx, await financePanel(ctx)); break
    case 'ringkasan': await sendPanel(ctx, await weeklyPanel(ctx)); break
    case 'pengingat': await sendPanel(ctx, await remindersPanel(ctx)); break
    case 'tambah': await askTask(ctx, arg); break
    case 'catat': await askNote(ctx, arg); break
    case 'belajar': await askSession(ctx, arg); break
    case 'putus': await cmdUnlink(ctx); break
    case '': await askNote(ctx, text, true); break
    default: await sendMessageKb(chatId, `Perintah tidak dikenal.\n\n${HELP}`, backKb())
  }
  return 'selesai'
}

async function loadCtx(db: SupabaseClient, telegramUserId: number, chatId: number): Promise<Ctx | null> {
  const { data: conn } = await db.from('telegram_connections').select('user_id, chat_id').eq('telegram_user_id', telegramUserId).maybeSingle()
  if (!conn) return null
  const { data: prof } = await db.from('profiles').select('display_name, timezone').eq('id', conn.user_id).maybeSingle()
  const tz = prof?.timezone && isValidTimeZone(prof.timezone) ? prof.timezone : DEFAULT_TZ
  if (Number(conn.chat_id) !== chatId) await db.from('telegram_connections').update({ chat_id: chatId }).eq('user_id', conn.user_id)
  return { db, chatId, userId: conn.user_id, tz, name: prof?.display_name || 'Kamu' }
}

/* ---------- Penautan (BT-01) ---------- */
async function linkAccount(db: SupabaseClient, chatId: number, from: TgUser, raw: string) {
  const code = raw.trim().toUpperCase()
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    await sendMessage(chatId, 'Kode tautan terdiri dari 6 huruf/angka. Buat kode baru di <b>Pengaturan → Bot Telegram</b>.')
    return 'selesai' as const
  }
  // Klaim kode secara atomik: hanya berhasil sekali & selama belum kedaluwarsa.
  const { data: claimed } = await db.from('telegram_link_codes').update({ used_at: new Date().toISOString() })
    .eq('code', code).is('used_at', null).gt('expires_at', new Date().toISOString()).select('user_id').maybeSingle()
  if (!claimed) {
    await sendMessage(chatId, '❌ Kode tidak valid, sudah dipakai, atau kedaluwarsa (berlaku 10 menit). Buat kode baru di Pengaturan.')
    return 'selesai' as const
  }
  const { data: other } = await db.from('telegram_connections').select('user_id').eq('telegram_user_id', from.id).maybeSingle()
  if (other && other.user_id !== claimed.user_id) {
    await sendMessage(chatId, 'Akun Telegram ini sudah tertaut ke akun Ruang Produktivitas lain. Kirim /putus dulu dari akun tersebut.')
    return 'selesai' as const
  }
  const { error } = await db.from('telegram_connections').upsert(
    { user_id: claimed.user_id, telegram_user_id: from.id, chat_id: chatId, username: (from.username ?? from.first_name ?? '').slice(0, 64), linked_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )
  if (error) throw error
  const ctx = await loadCtx(db, from.id, chatId)
  await sendMessage(chatId, `✅ <b>Tertaut dengan akun ${esc(ctx?.name || 'kamu')}.</b>\nPengingat tugas & ringkasan harian akan dikirim ke sini.`)
  if (ctx) await sendDashboard(ctx)
  return 'selesai' as const
}

async function cmdUnlink(ctx: Ctx) {
  await ctx.db.from('telegram_pending').delete().eq('user_id', ctx.userId)
  await ctx.db.from('telegram_connections').delete().eq('user_id', ctx.userId)
  await sendMessage(ctx.chatId, 'Bot sudah diputus dari akunmu. Pengingat tidak akan dikirim lagi. Tautkan kembali kapan saja dari Pengaturan.')
}

/* ---------- Panel: pesan yang bisa diganti isinya lewat tombol ---------- */
interface Panel { lines: string[]; kb: Keyboard }

const webBtn = (path = '/', text = '🌐 Buka Ruang Produktivitas') => (httpsSite() ? [{ text, url: `${siteUrl()}${path}` }] : [])
function backKb(path?: string, extra: Keyboard = []): Keyboard {
  const web = path ? webBtn(path, '🌐 Buka di aplikasi') : []
  return [...extra, [{ text: '⬅️ Kembali ke menu', callback_data: 'b:home' }, ...web]]
}

export function mainKeyboard(): Keyboard {
  const web = webBtn()
  return [
    [{ text: '📝 Catat Aktivitas', callback_data: 'm:catat' }, { text: '✅ Tugas Saya', callback_data: 'm:tugas' }],
    [{ text: '📚 Jurnal Belajar', callback_data: 'm:belajar' }, { text: '🎯 Target Saya', callback_data: 'm:target' }],
    [{ text: '💰 Keuangan', callback_data: 'm:uang' }, { text: '📊 Ringkasan', callback_data: 'm:ringkas' }],
    ...(web.length ? [web] : []),
  ]
}

/** Gabungkan baris; bila melebihi batas (keterangan foto 1024), buang baris dari bawah bagian isi. */
function render(lines: string[], max: number) {
  let out = lines.join('\n')
  if (out.length <= max) return out
  const keep = [...lines]
  while (keep.length > 3 && out.length > max - 20) { keep.splice(keep.length - 1, 1); out = keep.join('\n') }
  return `${out}\n…`
}

async function sendPanel(ctx: Pick<Ctx, 'chatId'>, p: Panel) {
  return sendMessageKb(ctx.chatId, render(p.lines, 4000), p.kb)
}

/** Ganti isi pesan yang tombolnya ditekan (foto → keterangan, teks → teks). Gagal → kirim pesan baru. */
async function showPanel(ctx: Ctx, p: Panel, msg?: TgMessage) {
  if (msg) {
    const r = msg.photo
      ? await editMessageCaption(ctx.chatId, msg.message_id, render(p.lines, 1024), p.kb)
      : await editMessageKb(ctx.chatId, msg.message_id, render(p.lines, 4000), p.kb)
    if (r.ok || /not modified/i.test(r.error)) return
  }
  await sendPanel(ctx, p)
}

/* ---------- Beranda (banner + ringkasan) ---------- */
let bannerFile: Promise<Buffer> | null = null
function banner(): string | Promise<Buffer> {
  // Produksi: Telegram mengambil gambar dari URL publik (di-cache Telegram). Lokal: unggah berkas.
  if (httpsSite()) return `${siteUrl()}/bot/header.jpg`
  bannerFile ??= readFile(join(process.cwd(), 'public/bot/header.jpg'))
  return bannerFile
}

function greetingFor(tz: string, now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now))
  return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam'
}

export async function todayAgenda(db: SupabaseClient, userId: string, tz: string) {
  const today = todayIn(tz)
  const from = startOfDayIso(today, tz)
  const to = startOfDayIso(addDays(today, 1), tz)
  const [overdue, dueToday, events] = await Promise.all([
    db.from('tasks').select('id, title, due_at').eq('user_id', userId).eq('kind', 'tugas').in('status', OPEN).lt('due_at', from).order('due_at').limit(10),
    db.from('tasks').select('id, title, due_at, start_at').eq('user_id', userId).eq('kind', 'tugas').in('status', OPEN)
      .or(`and(due_at.gte.${from},due_at.lt.${to}),and(due_at.is.null,start_at.gte.${from},start_at.lt.${to})`).order('due_at').limit(15),
    db.from('tasks').select('id, title, start_at, end_at, location').eq('user_id', userId).eq('kind', 'kegiatan').neq('status', 'dibatalkan')
      .gte('start_at', from).lt('start_at', to).order('start_at').limit(15),
  ])
  return { today, overdue: overdue.data ?? [], dueToday: dueToday.data ?? [], events: events.data ?? [] }
}

/** Baris agenda hari ini: terlambat dulu, lalu urut jam. */
function agendaBlock(a: Awaited<ReturnType<typeof todayAgenda>>, tz: string, limit = 6) {
  const now = Date.now()
  // Judul dipendekkan agar keterangan foto (maks. 1024 karakter) tetap muat.
  const short = (s: string) => esc(s.length > 60 ? `${s.slice(0, 58)}…` : s)
  const late = [
    ...a.overdue.map((t) => ({ title: t.title, time: formatShort(t.due_at!, tz) })),
    ...a.dueToday.filter((t) => t.due_at && new Date(t.due_at).getTime() < now).map((t) => ({ title: t.title, time: formatTime(t.due_at!, tz) })),
  ]
  const rest = [
    ...a.events.map((e) => ({ at: e.start_at!, line: `• <b>${formatTime(e.start_at!, tz)}</b> ${short(e.title)}${e.location ? ` <i>· ${short(e.location)}</i>` : ''}` })),
    ...a.dueToday.filter((t) => !(t.due_at && new Date(t.due_at).getTime() < now)).map((t) => {
      const at = (t.due_at ?? t.start_at)!
      return { at, line: `• ${at ? `<b>${formatTime(at, tz)}</b> ` : ''}${short(t.title)}` }
    }),
  ].sort((x, y) => x.at.localeCompare(y.at))
  const out: string[] = []
  if (late.length) {
    out.push(`⚠️ <b>${late.length} tugas terlambat</b>`)
    for (const t of late.slice(0, limit)) out.push(`• ${short(t.title)} — ${t.time}`)
  }
  if (rest.length) {
    if (late.length) out.push('')
    for (const r of rest.slice(0, Math.max(limit - Math.min(late.length, limit), 3))) out.push(r.line)
  }
  const shown = Math.min(late.length, limit) + Math.min(rest.length, Math.max(limit - Math.min(late.length, limit), 3))
  if (late.length + rest.length > shown) out.push(`<i>+${late.length + rest.length - shown} lainnya</i>`)
  if (!out.length) out.push('Tidak ada tugas atau kegiatan hari ini 🎉')
  return out
}

async function homePanel(ctx: Pick<Ctx, 'db' | 'userId' | 'tz' | 'name'>, note?: string): Promise<Panel> {
  const today = todayIn(ctx.tz)
  const [agenda, tasks, sessions, spend, goals] = await Promise.all([
    todayAgenda(ctx.db, ctx.userId, ctx.tz),
    ctx.db.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).eq('kind', 'tugas').in('status', OPEN),
    ctx.db.from('learning_sessions').select('duration_minutes').eq('user_id', ctx.userId).eq('session_date', today).limit(200),
    ctx.db.from('transactions').select('amount').eq('user_id', ctx.userId).eq('type', 'pengeluaran').eq('occurred_on', today).limit(1000),
    ctx.db.from('goals').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).eq('status', 'aktif'),
  ])
  const sess = sessions.data ?? []
  const minutes = sess.reduce((n, s) => n + s.duration_minutes, 0)
  const expense = (spend.data ?? []).reduce((n, r) => n + Number(r.amount), 0)
  const first = ctx.name.split(' ')[0] || ctx.name
  return {
    lines: [
      `👋 <b>${greetingFor(ctx.tz)}, ${esc(first)}!</b>`,
      'Berikut ringkasan aktivitasmu hari ini.',
      SEP,
      '📅 <b>Agenda hari ini</b>',
      ...agendaBlock(agenda, ctx.tz),
      SEP,
      '📌 <b>Ringkasan</b>',
      `• Tugas aktif: <b>${tasks.count ?? 0}</b>`,
      `• Belajar: <b>${sess.length} sesi</b>${minutes ? ` (${formatDuration(minutes)})` : ''}`,
      `• Pengeluaran hari ini: <b>${formatRupiah(expense)}</b>`,
      `• Target aktif: <b>${goals.count ?? 0}</b>`,
      ...(note ? [SEP, note] : []),
      SEP,
      '<b>Apa yang ingin kamu lakukan?</b>',
      '<i>Pilih menu di bawah ini 👇</i>',
    ],
    kb: mainKeyboard(),
  }
}

/** Pesan beranda: banner + ringkasan + menu. Bila foto gagal dikirim, kirim versi teks. */
export async function sendDashboard(ctx: Pick<Ctx, 'db' | 'chatId' | 'userId' | 'tz' | 'name'>, note?: string) {
  const p = await homePanel(ctx, note)
  const caption = render(p.lines, 1024)
  try {
    const photo = await banner()
    const res = await sendPhoto(ctx.chatId, photo, caption, p.kb)
    if (res.ok) return res
    console.error('kirim banner ditolak Telegram:', res.error)
  } catch (e) {
    console.error('kirim banner', e)
  }
  // Cadangan: pesan teks dengan isi & tombol yang sama.
  return sendMessageKb(ctx.chatId, caption, p.kb)
}

/* ---------- Panel menu ---------- */
function anchorOf(t: { kind: string; due_at: string | null; start_at: string | null }) {
  return t.kind === 'kegiatan' ? t.start_at : t.due_at ?? t.start_at
}

async function tasksPanel(ctx: Ctx): Promise<Panel> {
  const today = todayIn(ctx.tz)
  const startToday = new Date(startOfDayIso(today, ctx.tz)).getTime()
  const startTomorrow = new Date(startOfDayIso(addDays(today, 1), ctx.tz)).getTime()
  const { data } = await ctx.db.from('tasks').select('id, kind, title, due_at, start_at, location')
    .eq('user_id', ctx.userId).in('status', OPEN).limit(300)
  const now = Date.now()
  const late: string[] = [], todayL: Array<[number, string]> = [], next: Array<[number, string]> = [], none: string[] = []
  for (const t of data ?? []) {
    const at = anchorOf(t)
    const ms = at ? new Date(at).getTime() : null
    if (t.kind === 'kegiatan' && ms !== null && ms < startToday) continue
    const icon = t.kind === 'kegiatan' ? '📍 ' : ''
    if (t.kind === 'tugas' && t.due_at && new Date(t.due_at).getTime() < now) late.push(`• ${esc(t.title)} — ${formatShort(t.due_at, ctx.tz)}`)
    else if (ms !== null && ms < startTomorrow) todayL.push([ms, `• <b>${formatTime(at!, ctx.tz)}</b> ${icon}${esc(t.title)}`])
    else if (ms !== null) next.push([ms, `• ${formatShort(at!, ctx.tz)} — ${icon}${esc(t.title)}`])
    else none.push(`• ${esc(t.title)}`)
  }
  const sorted = (a: Array<[number, string]>) => a.sort((x, y) => x[0] - y[0]).map((x) => x[1])
  const total = late.length + todayL.length + next.length + none.length
  const lines = ['✅ <b>Tugas Saya</b>', `<i>${total} tugas & kegiatan belum selesai</i>`]
  if (late.length) lines.push(SEP, `⚠️ <b>Terlambat (${late.length})</b>`, ...late.slice(0, 8))
  if (todayL.length) lines.push(SEP, `📅 <b>Hari ini (${todayL.length})</b>`, ...sorted(todayL).slice(0, 10))
  if (next.length) lines.push(SEP, `🗓 <b>Mendatang (${next.length})</b>`, ...sorted(next).slice(0, 8))
  if (none.length) lines.push(SEP, `🗂 <b>Tanpa tanggal (${none.length})</b>`, ...none.slice(0, 5))
  if (!total) lines.push(SEP, 'Semua tugas beres. Mantap! 🎉')
  return { lines, kb: backKb('/tugas', [[{ text: '➕ Tambah tugas', callback_data: 'c:tugas' }]]) }
}

async function goalsPanel(ctx: Ctx): Promise<Panel> {
  const { data } = await ctx.db.from('goals').select(GOAL_COLUMNS).eq('user_id', ctx.userId).eq('status', 'aktif').order('created_at', { ascending: false }).limit(10)
  const goals = (data ?? []) as Goal[]
  const lines = ['🎯 <b>Target Saya</b>', `<i>${goals.length} target sedang berjalan</i>`, SEP]
  if (!goals.length) lines.push('Belum ada target aktif.')
  else {
    // goal_progress memakai security_invoker; klien service role melewati RLS → batasi ke id target milik pengguna.
    const { data: prog } = await ctx.db.from('goal_progress').select('goal_id, current_value, effective_target, effective_start, item_total, item_done').in('goal_id', goals.map((g) => g.id))
    const bar = (p: number) => '▰'.repeat(Math.round(p / 10)) + '▱'.repeat(10 - Math.round(p / 10))
    for (const g of mergeProgress(goals, (prog ?? []) as GoalProgressRow[])) lines.push(`<b>${esc(g.title)}</b>`, `${bar(g.percent)} <b>${g.percent}%</b>`, '')
    lines.pop()
  }
  return { lines, kb: backKb('/target') }
}

async function learningPanel(ctx: Ctx): Promise<Panel> {
  const today = todayIn(ctx.tz)
  const [subs, sess] = await Promise.all([
    ctx.db.from('learning_subjects').select('id, title').eq('user_id', ctx.userId).eq('status', 'aktif').order('title').limit(20),
    ctx.db.from('learning_sessions').select('subject_id, session_date, duration_minutes, material').eq('user_id', ctx.userId).gte('session_date', addDays(today, -6)).order('session_date', { ascending: false }).order('created_at', { ascending: false }).limit(500),
  ])
  const per = new Map<string, number>()
  for (const s of sess.data ?? []) per.set(s.subject_id, (per.get(s.subject_id) ?? 0) + s.duration_minutes)
  const total = [...per.values()].reduce((a, b) => a + b, 0)
  const name = new Map((subs.data ?? []).map((s) => [s.id, s.title]))
  const last = sess.data?.[0]
  return {
    lines: [
      '📚 <b>Jurnal Belajar</b>', '<i>7 hari terakhir</i>', SEP,
      `⏱ Total: <b>${formatDuration(total)}</b> · ${sess.data?.length ?? 0} sesi`,
      ...(last ? [`🕘 Terakhir: ${esc(name.get(last.subject_id) ?? 'Bidang')}${last.material ? ` — ${esc(last.material)}` : ''}`] : []),
      SEP, '<b>Bidang aktif</b>',
      ...((subs.data ?? []).length ? (subs.data ?? []).map((s) => `• ${esc(s.title)} — <b>${formatDuration(per.get(s.id) ?? 0)}</b>`) : ['Belum ada bidang belajar aktif.']),
    ],
    kb: backKb('/belajar', [[{ text: '➕ Catat sesi belajar', callback_data: 'c:belajar' }]]),
  }
}

async function financePanel(ctx: Ctx): Promise<Panel> {
  const today = todayIn(ctx.tz)
  const monthStart = `${today.slice(0, 7)}-01`
  const [tx, cats] = await Promise.all([
    ctx.db.from('transactions').select('type, amount, category_id, occurred_on').eq('user_id', ctx.userId).in('type', ['pemasukan', 'pengeluaran']).gte('occurred_on', monthStart).limit(5000),
    ctx.db.from('transaction_categories').select('id, name').eq('user_id', ctx.userId),
  ])
  let inc = 0, exp = 0, expToday = 0
  const byCat = new Map<string, number>()
  for (const t of tx.data ?? []) {
    const a = Number(t.amount)
    if (t.type === 'pemasukan') inc += a
    else {
      exp += a
      if (t.occurred_on === today) expToday += a
      byCat.set(t.category_id ?? '-', (byCat.get(t.category_id ?? '-') ?? 0) + a)
    }
  }
  const catName = new Map((cats.data ?? []).map((c) => [c.id, c.name]))
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const month = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(`${monthStart}T12:00:00Z`))
  return {
    lines: [
      '💰 <b>Keuangan</b>', `<i>${month}</i>`, SEP,
      `🟢 Pemasukan: <b>${formatRupiah(inc)}</b>`,
      `🔴 Pengeluaran: <b>${formatRupiah(exp)}</b>`,
      `${inc - exp < 0 ? '⚠️ Defisit' : '💵 Sisa'}: <b>${formatRupiah(Math.abs(inc - exp))}</b>`,
      `🧾 Pengeluaran hari ini: <b>${formatRupiah(expToday)}</b>`,
      ...(top.length ? [SEP, '<b>Pengeluaran terbesar</b>', ...top.map(([k, v]) => `• ${esc(catName.get(k) ?? 'Tanpa kategori')} — <b>${formatRupiah(v)}</b>`)] : []),
    ],
    kb: backKb('/keuangan'),
  }
}

async function weeklyPanel(ctx: Ctx): Promise<Panel> {
  const today = todayIn(ctx.tz)
  const cur = addDays(today, -6), prev = addDays(today, -13)
  const curIso = startOfDayIso(cur, ctx.tz)
  const [done, sess, notes, checks] = await Promise.all([
    ctx.db.from('tasks').select('completed_at').eq('user_id', ctx.userId).gte('completed_at', startOfDayIso(prev, ctx.tz)).limit(5000),
    ctx.db.from('learning_sessions').select('session_date, duration_minutes').eq('user_id', ctx.userId).gte('session_date', prev).limit(5000),
    ctx.db.from('journal_entries').select('entry_date').eq('user_id', ctx.userId).gte('entry_date', prev).limit(5000),
    ctx.db.from('habit_checkins').select('checkin_date').eq('user_id', ctx.userId).gte('checkin_date', prev).limit(10000),
  ])
  const split = <T,>(rows: T[] | null, isCur: (r: T) => boolean, w: (r: T) => number = () => 1) => {
    let c = 0, p = 0
    for (const r of rows ?? []) { if (isCur(r)) c += w(r); else p += w(r) }
    return [c, p] as const
  }
  const row = (icon: string, label: string, [c, p]: readonly [number, number], f: (n: number) => string = formatNumber) =>
    `${icon} ${label}: <b>${f(c)}</b> ${c > p ? '📈' : c < p ? '📉' : '➖'} <i>(sebelumnya ${f(p)})</i>`
  return {
    lines: [
      '📊 <b>Ringkasan</b>', '<i>7 hari terakhir dibanding 7 hari sebelumnya</i>', SEP,
      row('✅', 'Tugas selesai', split(done.data, (r) => r.completed_at! >= curIso)),
      row('📚', 'Waktu belajar', split(sess.data, (r) => r.session_date >= cur, (r) => r.duration_minutes), formatDuration),
      row('🗒', 'Catatan ditulis', split(notes.data, (r) => r.entry_date >= cur)),
      row('🔁', 'Check-in kebiasaan', split(checks.data, (r) => r.checkin_date >= cur)),
    ],
    kb: backKb('/pencapaian'),
  }
}

async function remindersPanel(ctx: Ctx): Promise<Panel> {
  const { data } = await ctx.db.from('tasks').select('id, kind, title, due_at, start_at, remind_before_minutes')
    .eq('user_id', ctx.userId).in('status', OPEN).not('remind_before_minutes', 'is', null).is('reminded_at', null).limit(200)
  const now = Date.now()
  const soon = (data ?? []).map((t) => ({ ...t, at: anchorOf(t) })).filter((t) => t.at)
    .map((t) => ({ ...t, fire: new Date(t.at!).getTime() - t.remind_before_minutes! * 60_000 }))
    .filter((t) => t.fire <= now + 86_400_000 && new Date(t.at!).getTime() > now).sort((a, b) => a.fire - b.fire).slice(0, 15)
  return {
    lines: [
      '🔔 <b>Pengingat</b>', '<i>24 jam ke depan</i>', SEP,
      ...(soon.length ? soon.map((t) => `• <b>${formatTime(new Date(t.fire).toISOString(), ctx.tz)}</b> ${esc(t.title)}`) : ['Tidak ada pengingat dalam 24 jam ke depan.', '<i>Atur lewat kolom “Ingatkan” saat menambah tugas.</i>']),
    ],
    kb: backKb(),
  }
}

function catatPanel(): Panel {
  return {
    lines: ['📝 <b>Catat Aktivitas</b>', '<i>Mau mencatat apa?</i>', SEP,
      '🗒 <b>Catatan</b> — ide, ringkasan, jurnal cepat',
      '✅ <b>Tugas baru</b> — dengan tenggat',
      '📚 <b>Sesi belajar</b> — bidang, durasi, materi'],
    kb: [
      [{ text: '🗒 Catatan', callback_data: 'c:catatan' }, { text: '✅ Tugas baru', callback_data: 'c:tugas' }],
      [{ text: '📚 Sesi belajar', callback_data: 'c:belajar' }],
      [{ text: '⬅️ Kembali ke menu', callback_data: 'b:home' }],
    ],
  }
}

async function catatHelp(ctx: Ctx, kind: string): Promise<Panel> {
  const back: Keyboard = [[{ text: '⬅️ Kembali', callback_data: 'm:catat' }]]
  if (kind === 'catatan') return { lines: ['🗒 <b>Catatan baru</b>', SEP, 'Kirim saja isi catatanmu sebagai pesan biasa.', 'Baris pertama menjadi judul.', '', '<i>Atau pakai:</i> <code>/catat isi catatan</code>', '', 'Rupi akan minta konfirmasi sebelum menyimpan ✅'], kb: back }
  if (kind === 'tugas') return { lines: ['✅ <b>Tugas baru</b>', SEP, 'Kirim dengan format:', '<code>/tambah judul tugas</code>', '', '<i>Contoh:</i>', '<code>/tambah Kirim laporan besok 09.00</code>', '<code>/tambah Bayar listrik 16.00</code>'], kb: back }
  const { data: subs } = await ctx.db.from('learning_subjects').select('title').eq('user_id', ctx.userId).eq('status', 'aktif').order('title').limit(20)
  return {
    lines: ['📚 <b>Sesi belajar</b>', SEP, 'Kirim dengan format:', '<code>/belajar MENIT BIDANG materi</code>', '', '<i>Contoh:</i>', `<code>/belajar 45 ${esc(subs?.[0]?.title ?? 'Next.js')} middleware</code>`,
      ...((subs ?? []).length ? [SEP, '<b>Bidang aktif</b>', ...(subs ?? []).map((s) => `• ${esc(s.title)}`)] : [SEP, 'Belum ada bidang aktif — tambahkan di Ruang Belajar.'])],
    kb: back,
  }
}

async function panelFor(ctx: Ctx, data: string): Promise<Panel | null> {
  switch (data) {
    case 'b:home': return homePanel(ctx)
    case 'm:catat': return catatPanel()
    case 'c:catatan': case 'c:tugas': case 'c:belajar': return catatHelp(ctx, data.slice(2))
    case 'm:tugas': return tasksPanel(ctx)
    case 'm:belajar': return learningPanel(ctx)
    case 'm:target': return goalsPanel(ctx)
    case 'm:uang': return financePanel(ctx)
    case 'm:ringkas': return weeklyPanel(ctx)
    default: return null
  }
}

/* ---------- Tulis data: selalu dengan konfirmasi (BT-04) ---------- */
const CONFIRM: Keyboard = [[{ text: '✅ Simpan', callback_data: 'ya' }, { text: '✖️ Batal', callback_data: 'batal' }]]

async function askNote(ctx: Ctx, text: string, freeText = false) {
  if (!text) { await showPanel(ctx, await catatHelp(ctx, 'catatan')); return }
  const body = text.slice(0, 50000)
  await ctx.db.from('telegram_pending').upsert({ chat_id: ctx.chatId, user_id: ctx.userId, action: 'catat', payload: { text: body }, created_at: new Date().toISOString() })
  const preview = body.length > 300 ? `${body.slice(0, 300)}…` : body
  await sendMessageKb(ctx.chatId, `🗒 <b>${freeText ? 'Simpan pesan ini sebagai catatan?' : 'Simpan catatan ini?'}</b>\n\n<blockquote>${esc(preview)}</blockquote>`, CONFIRM)
}

async function askSession(ctx: Ctx, arg: string) {
  const m = /^(\d{1,4})\s*(?:menit|mnt|m)?\s+([\s\S]+)$/i.exec(arg)
  if (!m) { await showPanel(ctx, await catatHelp(ctx, 'belajar')); return }
  const { data: subs } = await ctx.db.from('learning_subjects').select('id, title').eq('user_id', ctx.userId).eq('status', 'aktif').order('title').limit(100)
  const minutes = Number(m[1])
  if (minutes < 1 || minutes > 1440) { await sendMessage(ctx.chatId, 'Durasi harus 1–1440 menit.'); return }
  const rest = m[2]!.trim()
  const lower = rest.toLowerCase()
  // Cocokkan nama bidang terpanjang di awal teks (nama bidang bisa berisi spasi).
  const subject = (subs ?? []).filter((s) => lower === s.title.toLowerCase() || lower.startsWith(`${s.title.toLowerCase()} `))
    .sort((a, b) => b.title.length - a.title.length)[0]
  if (!subject) {
    const p = await catatHelp(ctx, 'belajar')
    await showPanel(ctx, { ...p, lines: ['❌ <b>Bidang belajar tidak ditemukan.</b>', ...p.lines.slice(1)] })
    return
  }
  const material = rest.slice(subject.title.length).trim().slice(0, 200)
  await ctx.db.from('telegram_pending').upsert({
    chat_id: ctx.chatId, user_id: ctx.userId, action: 'belajar',
    payload: { minutes, subject_id: subject.id, subject: subject.title, material, date: todayIn(ctx.tz) }, created_at: new Date().toISOString(),
  })
  await sendMessageKb(ctx.chatId, `📚 <b>Catat sesi belajar ini?</b>\n${SEP}\n📖 ${esc(subject.title)}\n⏱ ${formatDuration(minutes)}${material ? `\n📝 ${esc(material)}` : ''}`, CONFIRM)
}

async function askTask(ctx: Ctx, arg: string) {
  if (!arg) { await showPanel(ctx, await catatHelp(ctx, 'tugas')); return }
  // "judul [hari ini|besok|lusa] [jam] HH.MM" — waktu & hari opsional.
  const m = /^([\s\S]+?)(?:\s+(hari ini|besok|lusa))?(?:\s+(?:jam\s+|pukul\s+)?([01]?\d|2[0-3])[.:]([0-5]\d))?$/i.exec(arg.trim())
  const title = (m?.[1] ?? arg).trim().slice(0, 200)
  const dayWord = m?.[2]?.toLowerCase()
  const today = todayIn(ctx.tz)
  const day = dayWord === 'besok' ? addDays(today, 1) : dayWord === 'lusa' ? addDays(today, 2) : today
  const due = m?.[3] ? zonedToIso(`${day}T${m[3].padStart(2, '0')}:${m[4]}`, ctx.tz) : dayWord ? zonedToIso(`${day}T23:59`, ctx.tz) : null
  await ctx.db.from('telegram_pending').upsert({ chat_id: ctx.chatId, user_id: ctx.userId, action: 'tugas', payload: { title, due_at: due }, created_at: new Date().toISOString() })
  await sendMessageKb(ctx.chatId, `✅ <b>Tambah tugas ini?</b>\n${SEP}\n📌 ${esc(title)}\n${due ? `⏰ Tenggat ${formatShort(due, ctx.tz)}` : '<i>Tanpa tenggat</i>'}`, CONFIRM)
}

/* ---------- Tombol ---------- */
async function handleCallback(db: SupabaseClient, cb: TgCallback): Promise<'selesai' | 'diabaikan'> {
  const msg = cb.message
  if (!msg || msg.chat.type !== 'private') { await answerCallback(cb.id); return 'diabaikan' }
  const ctx = await loadCtx(db, cb.from.id, msg.chat.id)
  if (!ctx) { await answerCallback(cb.id, 'Akun belum ditautkan.'); return 'selesai' }
  const data = cb.data ?? ''

  // Menu (m:/c:/b:) — mengganti isi pesan yang sama, tidak menambah pesan baru.
  if (/^[mcb]:/.test(data)) {
    await answerCallback(cb.id)
    // Kembali ke beranda dari pesan teks (bukan foto) → kirim beranda lengkap dengan banner.
    if (data === 'b:home' && !msg.photo) { await sendDashboard(ctx); return 'selesai' }
    const p = await panelFor(ctx, data)
    if (p) await showPanel(ctx, p, msg)
    return 'selesai'
  }

  // Pengingat: "Tandai selesai" (d:<id tugas>)
  if (data.startsWith('d:')) {
    const id = data.slice(2)
    if (!/^[0-9a-f-]{36}$/i.test(id)) { await answerCallback(cb.id); return 'selesai' }
    const { data: t } = await db.from('tasks').update({ status: 'selesai' }).eq('id', id).eq('user_id', ctx.userId).eq('kind', 'tugas').select('title').maybeSingle()
    await answerCallback(cb.id, t ? 'Ditandai selesai ✅' : 'Tugas tidak ditemukan.')
    if (t) await editMessageKb(ctx.chatId, msg.message_id, `✅ <b>Selesai:</b> ${esc(t.title)}\n<i>Kerja bagus! 🎉</i>`, [[{ text: '🏠 Menu', callback_data: 'b:home' }]])
    return 'selesai'
  }

  const { data: p } = await db.from('telegram_pending').select('user_id, action, payload, created_at').eq('chat_id', ctx.chatId).maybeSingle()
  const stale = !p || p.user_id !== ctx.userId || Date.now() - new Date(p.created_at).getTime() > 86_400_000
  if (stale) {
    await answerCallback(cb.id, 'Konfirmasi sudah tidak berlaku.')
    await editMessage(ctx.chatId, msg.message_id, 'Konfirmasi ini sudah tidak berlaku. Kirim ulang perintahnya.')
    return 'selesai'
  }
  // Hapus dulu (klaim) agar tombol yang ditekan dua kali tidak menyimpan dua kali.
  const { data: gone } = await db.from('telegram_pending').delete().eq('chat_id', ctx.chatId).eq('created_at', p.created_at).select('chat_id')
  if (!gone?.length) { await answerCallback(cb.id); return 'selesai' }
  const after: Keyboard = [[{ text: '🏠 Menu', callback_data: 'b:home' }]]
  if (data !== 'ya') {
    await answerCallback(cb.id, 'Dibatalkan')
    await editMessageKb(ctx.chatId, msg.message_id, '✖️ <i>Dibatalkan — tidak ada yang disimpan.</i>', after)
    return 'selesai'
  }
  const pl = p.payload as Record<string, unknown>
  if (p.action === 'catat') {
    const text = String(pl.text ?? '')
    const [first = '', ...rest] = text.split('\n')
    const title = first.length <= 120 ? first.trim() : ''
    const content = title ? rest.join('\n').trim() : text
    const { error } = await db.from('journal_entries')
      .insert({ user_id: ctx.userId, kind: 'catatan', title, content, entry_date: todayIn(ctx.tz), tags: ['telegram'] })
    if (error) throw error
    await answerCallback(cb.id, 'Tersimpan')
    await editMessageKb(ctx.chatId, msg.message_id, `✅ <b>Catatan tersimpan</b>${title ? `\n🗒 ${esc(title)}` : ''}`, after)
  } else if (p.action === 'tugas') {
    const { error } = await db.from('tasks')
      .insert({ user_id: ctx.userId, kind: 'tugas', title: String(pl.title), due_at: pl.due_at ?? null, priority: 'sedang', status: 'belum' })
    if (error) throw error
    await answerCallback(cb.id, 'Tersimpan')
    await editMessageKb(ctx.chatId, msg.message_id, `✅ <b>Tugas ditambahkan</b>\n📌 ${esc(String(pl.title))}${pl.due_at ? `\n⏰ Tenggat ${formatShort(String(pl.due_at), ctx.tz)}` : ''}`, after)
  } else {
    const { error } = await db.from('learning_sessions').insert({
      user_id: ctx.userId, subject_id: pl.subject_id, session_date: pl.date, duration_minutes: pl.minutes, material: pl.material ?? '',
    })
    if (error) throw error
    await answerCallback(cb.id, 'Tersimpan')
    await editMessageKb(ctx.chatId, msg.message_id, `✅ <b>Sesi belajar tercatat</b>\n📖 ${esc(String(pl.subject))} · ${formatDuration(Number(pl.minutes))}`, after)
  }
  return 'selesai'
}

/* ---------- Pesan pengingat (dipakai cron) ---------- */
export function reminderText(t: { id: string; kind: string; title: string; due_at: string | null; start_at: string | null; end_at: string | null; location: string }, tz: string) {
  const at = anchorOf(t)
  const mins = at ? Math.round((new Date(at).getTime() - Date.now()) / 60_000) : null
  const rel = mins === null ? '' : mins <= 0 ? 'sekarang' : mins < 60 ? `${mins} menit lagi` : `${formatDuration(mins)} lagi`
  const head = t.kind === 'kegiatan' ? '📅 <b>Pengingat kegiatan</b>' : '⏰ <b>Pengingat tugas</b>'
  const when = t.kind === 'kegiatan'
    ? `🕘 Mulai ${formatShort(at!, tz)}${t.end_at ? `–${formatTime(t.end_at, tz)}` : ''}`
    : `🕘 ${t.due_at ? 'Tenggat' : 'Mulai'} ${formatShort(at!, tz)}`
  return [head, SEP, `<b>${esc(t.title)}</b>`, when, ...(rel ? [`⏳ <i>${rel}</i>`] : []), ...(t.location ? [`📍 ${esc(t.location)}`] : [])].join('\n')
}

export function reminderKeyboard(t: { id: string; kind: string }): Keyboard {
  const web = webBtn(`/tugas/${t.id}`, '🌐 Buka')
  return [
    [...(t.kind === 'tugas' ? [{ text: '✅ Tandai selesai', callback_data: `d:${t.id}` }] : []), { text: '🏠 Menu', callback_data: 'b:home' }],
    ...(web.length ? [web] : []),
  ]
}
