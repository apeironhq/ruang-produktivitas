import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { renderDashboardCard, type CardData } from './bot-card'
import { DEFAULT_TZ, isValidTimeZone, startOfDayIso, todayIn, addDays, zonedToIso } from './dates'
import { formatDayLong, formatDuration, formatNumber, formatRupiah, formatShort, formatTime } from './format'
import { GOAL_COLUMNS, mergeProgress } from './queries'
import type { Goal, GoalProgressRow } from './types'
import { answerCallback, editMessage, esc, sendMessage, sendMessageKb, sendPhoto, type Keyboard } from './telegram'

/* ---------- Tipe minimal update Telegram ---------- */
interface TgUser { id: number; username?: string; first_name?: string }
interface TgMessage { message_id: number; chat: { id: number; type: string }; from?: TgUser; text?: string }
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
/** Tombol yang membuka Mini App Rupi di dalam Telegram (hanya bila alamat https tersedia). */
export const miniAppButton = (text = '🐰 Buka Rupi') => (siteUrl().startsWith('https://') ? [{ text, web_app: { url: `${siteUrl()}/tg` } }] : [])
const appLink = (path: string, label = 'Buka di aplikasi') => (siteUrl() ? `\n\n<a href="${siteUrl()}${path}">${label}</a>` : '')

const HELP = [
  '<b>Perintah Ruang Produktivitas</b>',
  '/menu — ringkasan hari ini & menu utama',
  '/tugas — tugas & kegiatan hari ini',
  '/tambah <i>judul [besok] [09.00]</i> — tambah tugas',
  '/catat <i>isi</i> — simpan catatan cepat',
  '/belajar <i>menit bidang materi</i> — catat sesi belajar\n   contoh: <code>/belajar 45 Next.js middleware</code>',
  '/target — progres target aktif',
  '/pengingat — pengingat 24 jam ke depan',
  '/putus — putuskan bot dari akun',
  '',
  'Pesan biasa tanpa perintah akan ditawarkan untuk disimpan sebagai catatan.',
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
      '👋 Halo! Bot ini belum ditautkan ke akun Ruang Produktivitas.',
      '',
      'Buka <b>Pengaturan → Telegram</b> di aplikasi, tekan <b>Buat kode tautan</b>, lalu kirim:',
      '<code>/mulai KODE</code>',
    ].join('\n') + appLink('/pengaturan', 'Buka Pengaturan'))
    return 'selesai'
  }

  switch (cmd ? name : '') {
    case 'start': case 'mulai': case 'menu': await sendDashboard(ctx); break
    case 'bantuan': case 'help': await sendMessage(chatId, HELP); break
    case 'tugas': await cmdTasks(ctx); break
    case 'tambah': await askTask(ctx, arg); break
    case 'keuangan': await cmdFinance(ctx); break
    case 'ringkasan': await cmdWeekly(ctx); break
    case 'target': await cmdGoals(ctx); break
    case 'pengingat': await cmdReminders(ctx); break
    case 'catat': await askNote(ctx, arg); break
    case 'belajar': await askSession(ctx, arg); break
    case 'putus': await cmdUnlink(ctx); break
    case '': await askNote(ctx, text, true); break
    default: await sendMessage(chatId, `Perintah tidak dikenal.\n\n${HELP}`)
  }
  return 'selesai'
}

async function loadCtx(db: SupabaseClient, telegramUserId: number, chatId: number): Promise<Ctx | null> {
  const { data: conn } = await db.from('telegram_connections').select('user_id, chat_id').eq('telegram_user_id', telegramUserId).maybeSingle()
  if (!conn) return null
  const { data: prof } = await db.from('profiles').select('display_name, timezone').eq('id', conn.user_id).maybeSingle()
  const tz = prof?.timezone && isValidTimeZone(prof.timezone) ? prof.timezone : DEFAULT_TZ
  if (Number(conn.chat_id) !== chatId) await db.from('telegram_connections').update({ chat_id: chatId }).eq('user_id', conn.user_id)
  return { db, chatId, userId: conn.user_id, tz, name: prof?.display_name || 'Pengguna' }
}

/* ---------- Penautan (BT-01) ---------- */
async function linkAccount(db: SupabaseClient, chatId: number, from: TgUser, raw: string) {
  const code = raw.trim().toUpperCase()
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    await sendMessage(chatId, 'Kode tautan terdiri dari 6 huruf/angka. Buat kode baru di <b>Pengaturan → Telegram</b>.')
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
  await sendMessage(chatId, `✅ Tertaut dengan akun <b>${esc(ctx?.name || 'Anda')}</b>. Pengingat tugas & ringkasan harian akan dikirim ke sini.`)
  if (ctx) await sendDashboard(ctx)
  return 'selesai' as const
}

async function cmdUnlink(ctx: Ctx) {
  await ctx.db.from('telegram_pending').delete().eq('user_id', ctx.userId)
  await ctx.db.from('telegram_connections').delete().eq('user_id', ctx.userId)
  await sendMessage(ctx.chatId, 'Bot sudah diputus dari akun Anda. Pengingat tidak akan dikirim lagi. Tautkan kembali kapan saja dari Pengaturan.')
}

/* ---------- Baca data ---------- */
function anchorOf(t: { kind: string; due_at: string | null; start_at: string | null }) {
  return t.kind === 'kegiatan' ? t.start_at : t.due_at ?? t.start_at
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

export function agendaLines(a: Awaited<ReturnType<typeof todayAgenda>>, tz: string) {
  const out: string[] = []
  if (a.events.length) {
    out.push('<b>Kegiatan</b>')
    for (const e of a.events) out.push(`• ${formatTime(e.start_at!, tz)}${e.end_at ? `–${formatTime(e.end_at, tz)}` : ''} ${esc(e.title)}${e.location ? ` <i>(${esc(e.location)})</i>` : ''}`)
  }
  if (a.dueToday.length) {
    out.push('', '<b>Tugas hari ini</b>')
    for (const t of a.dueToday) out.push(`• ${t.due_at ? `${formatTime(t.due_at, tz)} ` : ''}${esc(t.title)}`)
  }
  if (a.overdue.length) {
    out.push('', `<b>⚠️ Terlambat (${a.overdue.length})</b>`)
    for (const t of a.overdue) out.push(`• ${esc(t.title)} — ${formatShort(t.due_at!, tz)}`)
  }
  return out
}

async function cmdTasks(ctx: Ctx) {
  const a = await todayAgenda(ctx.db, ctx.userId, ctx.tz)
  const lines = agendaLines(a, ctx.tz)
  await sendMessage(ctx.chatId, (lines.length ? `📋 <b>Agenda hari ini</b>\n\n${lines.join('\n')}` : '🎉 Tidak ada tugas atau kegiatan untuk hari ini.') + appLink('/tugas'))
}

async function cmdGoals(ctx: Ctx) {
  const { data } = await ctx.db.from('goals').select(GOAL_COLUMNS).eq('user_id', ctx.userId).eq('status', 'aktif').order('created_at', { ascending: false }).limit(10)
  const goals = (data ?? []) as Goal[]
  if (!goals.length) { await sendMessage(ctx.chatId, 'Belum ada target aktif.' + appLink('/target')); return }
  // goal_progress memakai security_invoker; klien service role melewati RLS → batasi ke id target milik pengguna.
  const { data: prog } = await ctx.db.from('goal_progress').select('goal_id, current_value, effective_target, effective_start, item_total, item_done').in('goal_id', goals.map((g) => g.id))
  const rows = mergeProgress(goals, (prog ?? []) as GoalProgressRow[])
  const bar = (p: number) => '▰'.repeat(Math.round(p / 10)) + '▱'.repeat(10 - Math.round(p / 10))
  await sendMessage(ctx.chatId, ['🎯 <b>Target aktif</b>', '', ...rows.map((g) => `<b>${esc(g.title)}</b>\n${bar(g.percent)} ${g.percent}%`)].join('\n') + appLink('/target'))
}

async function cmdReminders(ctx: Ctx) {
  const { data } = await ctx.db.from('tasks').select('id, kind, title, due_at, start_at, remind_before_minutes')
    .eq('user_id', ctx.userId).in('status', OPEN).not('remind_before_minutes', 'is', null).is('reminded_at', null).limit(200)
  const now = Date.now()
  const soon = (data ?? []).map((t) => ({ ...t, at: anchorOf(t) })).filter((t) => t.at)
    .map((t) => ({ ...t, fire: new Date(t.at!).getTime() - t.remind_before_minutes! * 60_000 }))
    .filter((t) => t.fire <= now + 86_400_000 && new Date(t.at!).getTime() > now).sort((a, b) => a.fire - b.fire).slice(0, 15)
  if (!soon.length) { await sendMessage(ctx.chatId, 'Tidak ada pengingat dalam 24 jam ke depan.\n\nAtur pengingat lewat kolom <b>Ingatkan</b> saat menambah tugas.'); return }
  await sendMessage(ctx.chatId, ['🔔 <b>Pengingat 24 jam ke depan</b>', '', ...soon.map((t) => `• ${formatShort(new Date(t.fire).toISOString(), ctx.tz)} — ${esc(t.title)}`)].join('\n'))
}

/* ---------- Tulis data: selalu dengan konfirmasi (BT-04) ---------- */
const CONFIRM = [[{ text: '✅ Simpan', callback_data: 'ya' }, { text: 'Batal', callback_data: 'batal' }]]

async function askNote(ctx: Ctx, text: string, freeText = false) {
  if (!text) { await sendMessage(ctx.chatId, 'Tulis isinya setelah perintah, mis.:\n<code>/catat Ide: fitur ekspor PDF</code>'); return }
  const body = text.slice(0, 50000)
  await ctx.db.from('telegram_pending').upsert({ chat_id: ctx.chatId, user_id: ctx.userId, action: 'catat', payload: { text: body }, created_at: new Date().toISOString() })
  const preview = body.length > 300 ? `${body.slice(0, 300)}…` : body
  await sendMessage(ctx.chatId, `${freeText ? 'Simpan pesan ini sebagai catatan?' : 'Simpan catatan ini?'}\n\n<blockquote>${esc(preview)}</blockquote>`, CONFIRM)
}

async function askSession(ctx: Ctx, arg: string) {
  const m = /^(\d{1,4})\s*(?:menit|mnt|m)?\s+([\s\S]+)$/i.exec(arg)
  const { data: subs } = await ctx.db.from('learning_subjects').select('id, title').eq('user_id', ctx.userId).eq('status', 'aktif').order('title').limit(100)
  const list = (subs ?? []).map((s) => `• ${esc(s.title)}`).join('\n')
  const usage = `Format: <code>/belajar MENIT BIDANG materi</code>\nContoh: <code>/belajar 45 ${esc(subs?.[0]?.title ?? 'Next.js')} middleware</code>`
  if (!m) { await sendMessage(ctx.chatId, `${usage}${list ? `\n\n<b>Bidang aktif</b>\n${list}` : ''}`); return }
  const minutes = Number(m[1])
  if (minutes < 1 || minutes > 1440) { await sendMessage(ctx.chatId, 'Durasi harus 1–1440 menit.'); return }
  const rest = m[2]!.trim()
  const lower = rest.toLowerCase()
  // Cocokkan nama bidang terpanjang di awal teks (nama bidang bisa berisi spasi).
  const subject = (subs ?? []).filter((s) => lower === s.title.toLowerCase() || lower.startsWith(`${s.title.toLowerCase()} `))
    .sort((a, b) => b.title.length - a.title.length)[0]
  if (!subject) { await sendMessage(ctx.chatId, `Bidang belajar tidak ditemukan.\n\n${usage}${list ? `\n\n<b>Bidang aktif</b>\n${list}` : '\n\nBelum ada bidang aktif — tambahkan di Ruang Belajar.'}`); return }
  const material = rest.slice(subject.title.length).trim().slice(0, 200)
  await ctx.db.from('telegram_pending').upsert({
    chat_id: ctx.chatId, user_id: ctx.userId, action: 'belajar',
    payload: { minutes, subject_id: subject.id, subject: subject.title, material, date: todayIn(ctx.tz) }, created_at: new Date().toISOString(),
  })
  await sendMessage(ctx.chatId, `Catat sesi belajar ini?\n\n📚 <b>${esc(subject.title)}</b>\n⏱ ${formatDuration(minutes)}${material ? `\n📝 ${esc(material)}` : ''}`, CONFIRM)
}

async function handleCallback(db: SupabaseClient, cb: TgCallback): Promise<'selesai' | 'diabaikan'> {
  const msg = cb.message
  if (!msg || msg.chat.type !== 'private') { await answerCallback(cb.id); return 'diabaikan' }
  const ctx = await loadCtx(db, cb.from.id, msg.chat.id)
  if (!ctx) { await answerCallback(cb.id, 'Akun belum ditautkan.'); return 'selesai' }
  // Tombol menu utama (m:…) & pilihan "Catat Aktivitas" (c:…) — hanya membaca/menampilkan petunjuk.
  if (cb.data?.startsWith('m:') || cb.data?.startsWith('c:')) {
    await answerCallback(cb.id)
    await handleMenu(ctx, cb.data)
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
  if (cb.data !== 'ya') {
    await answerCallback(cb.id, 'Dibatalkan')
    await editMessage(ctx.chatId, msg.message_id, 'Dibatalkan — tidak ada yang disimpan.')
    return 'selesai'
  }
  const pl = p.payload as Record<string, unknown>
  if (p.action === 'catat') {
    const text = String(pl.text ?? '')
    const [first = '', ...rest] = text.split('\n')
    const title = first.length <= 120 ? first.trim() : ''
    const content = title ? rest.join('\n').trim() : text
    const { data, error } = await db.from('journal_entries')
      .insert({ user_id: ctx.userId, kind: 'catatan', title, content, entry_date: todayIn(ctx.tz), tags: ['telegram'] }).select('id').single()
    if (error) throw error
    await answerCallback(cb.id, 'Tersimpan')
    await editMessage(ctx.chatId, msg.message_id, `✅ Catatan tersimpan${title ? `: <b>${esc(title)}</b>` : ''}.` + appLink(`/jurnal/${data.id}`, 'Lihat catatan'))
  } else if (p.action === 'tugas') {
    const { data, error } = await db.from('tasks')
      .insert({ user_id: ctx.userId, kind: 'tugas', title: String(pl.title), due_at: pl.due_at ?? null, priority: 'sedang', status: 'belum' }).select('id').single()
    if (error) throw error
    await answerCallback(cb.id, 'Tersimpan')
    await editMessage(ctx.chatId, msg.message_id, `✅ Tugas ditambahkan: <b>${esc(String(pl.title))}</b>${pl.due_at ? `\nTenggat ${formatShort(String(pl.due_at), ctx.tz)}` : ''}` + appLink(`/tugas/${data.id}`, 'Atur detail di aplikasi'))
  } else {
    const { error } = await db.from('learning_sessions').insert({
      user_id: ctx.userId, subject_id: pl.subject_id, session_date: pl.date, duration_minutes: pl.minutes, material: pl.material ?? '',
    })
    if (error) throw error
    await answerCallback(cb.id, 'Tersimpan')
    await editMessage(ctx.chatId, msg.message_id, `✅ Sesi belajar <b>${esc(String(pl.subject))}</b> ${formatDuration(Number(pl.minutes))} tercatat.` + appLink(`/belajar/${pl.subject_id}`, 'Lihat bidang'))
  }
  return 'selesai'
}

/* ---------- Kartu ringkasan & menu utama ---------- */
export function mainKeyboard(): Keyboard {
  const app = miniAppButton('🐰 Buka Rupi — tampilan lengkap')
  const kb: Keyboard = [
    ...(app.length ? [app] : []),
    [{ text: '📝 Catat Aktivitas', callback_data: 'm:catat' }, { text: '📋 Tugas Saya', callback_data: 'm:tugas' }],
    [{ text: '📖 Jurnal Belajar', callback_data: 'm:belajar' }, { text: '🎯 Target Saya', callback_data: 'm:target' }],
    [{ text: '💰 Keuangan', callback_data: 'm:uang' }, { text: '📊 Ringkasan', callback_data: 'm:ringkas' }],
  ]
  // Tombol URL hanya boleh https (localhost ditolak Telegram).
  if (siteUrl().startsWith('https://')) kb.push([{ text: '↗️ Buka Ruang Produktivitas', url: `${siteUrl()}/` }])
  return kb
}

function greetingFor(tz: string, now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now))
  return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam'
}

const MAX_AGENDA = 6

export async function buildCardData(db: SupabaseClient, userId: string, tz: string, name: string): Promise<CardData> {
  const [agenda, tasks, sessions, spend, goals] = await Promise.all([
    todayAgenda(db, userId, tz),
    db.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('kind', 'tugas').in('status', OPEN),
    db.from('learning_sessions').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('session_date', todayIn(tz)),
    db.from('transactions').select('amount').eq('user_id', userId).eq('type', 'pengeluaran').eq('occurred_on', todayIn(tz)).limit(1000),
    db.from('goals').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'aktif'),
  ])
  const items = [
    ...agenda.overdue.map((t) => ({ title: t.title, at: t.due_at!, time: isoDayLabel(t.due_at!, tz, agenda.today), late: true, event: false })),
    ...agenda.events.map((e) => ({ title: e.title, at: e.start_at!, time: formatTime(e.start_at!, tz), late: false, event: true })),
    ...agenda.dueToday.map((t) => ({ title: t.title, at: (t.due_at ?? t.start_at)!, time: t.due_at || t.start_at ? formatTime((t.due_at ?? t.start_at)!, tz) : '', late: !!t.due_at && new Date(t.due_at).getTime() < Date.now(), event: false })),
  ]
  const ordered = [...items.filter((i) => i.late), ...items.filter((i) => !i.late).sort((a, b) => a.at.localeCompare(b.at))]
  const total = (spend.data ?? []).reduce((n, r) => n + Number(r.amount), 0)
  return {
    greeting: greetingFor(tz),
    name: name.split(' ')[0] || name,
    dateLabel: formatDayLong(agenda.today).replace(/^(\w+) /, '$1, '),
    stats: { tasks: tasks.count ?? 0, sessions: sessions.count ?? 0, expense: formatRupiah(total), goals: goals.count ?? 0 },
    agenda: ordered.slice(0, MAX_AGENDA).map(({ title, time, late, event }) => ({ title, time, late, event })),
    more: Math.max(ordered.length - MAX_AGENDA, 0),
  }
}

/** Tenggat yang sudah lewat: tampilkan jam bila kemarin/hari ini, tanggal bila lebih lama. */
function isoDayLabel(iso: string, tz: string, today: string) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso))
  return day === today || day === addDays(today, -1) ? formatTime(iso, tz) : formatShort(iso, tz).replace(/,.*$/, '')
}

/** Kirim kartu ringkasan (gambar) + tombol menu. Bila render gambar gagal, kirim versi teks. */
export async function sendDashboard(ctx: Pick<Ctx, 'db' | 'chatId' | 'userId' | 'tz' | 'name'>, caption = '✨ <b>Apa yang ingin kamu lakukan sekarang?</b>') {
  const data = await buildCardData(ctx.db, ctx.userId, ctx.tz, ctx.name)
  try {
    const png = await renderDashboardCard(data)
    const res = await sendPhoto(ctx.chatId, png, caption, mainKeyboard())
    if (res.ok || !res.retryable) return res
  } catch (e) {
    console.error('render kartu', e)
  }
  const lines = [
    `<b>${esc(data.greeting)}, ${esc(data.name)}!</b>`, data.dateLabel, '',
    `✅ Tugas aktif: <b>${data.stats.tasks}</b> · 📖 Belajar hari ini: <b>${data.stats.sessions} sesi</b>`,
    `💸 Pengeluaran: <b>${data.stats.expense}</b> · 🎯 Target aktif: <b>${data.stats.goals}</b>`, '',
    '<b>Agenda hari ini</b>',
    ...(data.agenda.length ? data.agenda.map((a) => `• ${a.time ? `${a.time} ` : ''}${esc(a.title)}${a.late ? ' — <i>terlambat</i>' : ''}`) : ['Tidak ada agenda.']),
    '', caption,
  ]
  return sendMessageKb(ctx.chatId, lines.join('\n'), mainKeyboard())
}

async function handleMenu(ctx: Ctx, data: string) {
  switch (data) {
    case 'm:catat':
      await sendMessageKb(ctx.chatId, '📝 <b>Catat aktivitas</b>\nMau mencatat apa?', [
        [{ text: '🗒 Catatan', callback_data: 'c:catatan' }, { text: '📚 Sesi belajar', callback_data: 'c:belajar' }],
        [{ text: '✅ Tugas baru', callback_data: 'c:tugas' }],
      ])
      break
    case 'c:catatan': await sendMessage(ctx.chatId, 'Kirim saja isi catatanmu sebagai pesan biasa — atau <code>/catat isi catatan</code>. Baris pertama jadi judul. Rupi akan minta konfirmasi sebelum menyimpan.'); break
    case 'c:belajar': await askSession(ctx, ''); break
    case 'c:tugas': await sendMessage(ctx.chatId, 'Kirim: <code>/tambah judul tugas</code>\nBisa ditambah waktu, mis.:\n<code>/tambah Kirim laporan besok 09.00</code>\n<code>/tambah Bayar listrik 16.00</code>'); break
    case 'm:tugas': await cmdTasks(ctx); break
    case 'm:belajar': await cmdLearning(ctx); break
    case 'm:target': await cmdGoals(ctx); break
    case 'm:uang': await cmdFinance(ctx); break
    case 'm:ringkas': await cmdWeekly(ctx); break
  }
}

async function askTask(ctx: Ctx, arg: string) {
  if (!arg) { await handleMenu(ctx, 'c:tugas'); return }
  // "judul [hari ini|besok|lusa] [jam] HH.MM" — waktu & hari opsional.
  const m = /^([\s\S]+?)(?:\s+(hari ini|besok|lusa))?(?:\s+(?:jam\s+|pukul\s+)?([01]?\d|2[0-3])[.:]([0-5]\d))?$/i.exec(arg.trim())
  const title = (m?.[1] ?? arg).trim().slice(0, 200)
  const dayWord = m?.[2]?.toLowerCase()
  const today = todayIn(ctx.tz)
  const day = dayWord === 'besok' ? addDays(today, 1) : dayWord === 'lusa' ? addDays(today, 2) : today
  const due = m?.[3] ? zonedToIso(`${day}T${m[3].padStart(2, '0')}:${m[4]}`, ctx.tz) : dayWord ? zonedToIso(`${day}T23:59`, ctx.tz) : null
  await ctx.db.from('telegram_pending').upsert({ chat_id: ctx.chatId, user_id: ctx.userId, action: 'tugas', payload: { title, due_at: due }, created_at: new Date().toISOString() })
  await sendMessage(ctx.chatId, `Tambah tugas ini?\n\n✅ <b>${esc(title)}</b>${due ? `\n⏰ Tenggat ${formatShort(due, ctx.tz)}` : '\n<i>tanpa tenggat</i>'}`, CONFIRM)
}

async function cmdLearning(ctx: Ctx) {
  const today = todayIn(ctx.tz)
  const weekFrom = addDays(today, -6)
  const [subs, sess] = await Promise.all([
    ctx.db.from('learning_subjects').select('id, title').eq('user_id', ctx.userId).eq('status', 'aktif').order('title').limit(20),
    ctx.db.from('learning_sessions').select('subject_id, session_date, duration_minutes, material').eq('user_id', ctx.userId).gte('session_date', weekFrom).order('session_date', { ascending: false }).limit(500),
  ])
  const per = new Map<string, number>()
  for (const s of sess.data ?? []) per.set(s.subject_id, (per.get(s.subject_id) ?? 0) + s.duration_minutes)
  const total = [...per.values()].reduce((a, b) => a + b, 0)
  const last = sess.data?.[0]
  const name = new Map((subs.data ?? []).map((s) => [s.id, s.title]))
  const lines = [
    '📖 <b>Jurnal belajar — 7 hari terakhir</b>', '',
    `Total: <b>${formatDuration(total)}</b> dalam ${sess.data?.length ?? 0} sesi`,
    ...(last ? [`Terakhir: ${esc(name.get(last.subject_id) ?? 'Bidang')}${last.material ? ` — ${esc(last.material)}` : ''}`] : []),
    '',
    ...((subs.data ?? []).length ? (subs.data ?? []).map((s) => `• ${esc(s.title)} — ${formatDuration(per.get(s.id) ?? 0)}`) : ['Belum ada bidang belajar aktif.']),
    '', `Catat sesi: <code>/belajar 45 ${esc(subs.data?.[0]?.title ?? 'Next.js')} materi</code>`,
  ]
  await sendMessage(ctx.chatId, lines.join('\n') + appLink('/belajar'))
}

async function cmdFinance(ctx: Ctx) {
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
      const k = t.category_id ?? '-'
      byCat.set(k, (byCat.get(k) ?? 0) + a)
    }
  }
  const catName = new Map((cats.data ?? []).map((c) => [c.id, c.name]))
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const month = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(`${monthStart}T12:00:00Z`))
  const lines = [
    `💰 <b>Keuangan — ${month}</b>`, '',
    `Pemasukan: <b>${formatRupiah(inc)}</b>`,
    `Pengeluaran: <b>${formatRupiah(exp)}</b>`,
    `Selisih: <b>${formatRupiah(inc - exp)}</b>`,
    `Pengeluaran hari ini: <b>${formatRupiah(expToday)}</b>`,
    ...(top.length ? ['', '<b>Pengeluaran terbesar</b>', ...top.map(([k, v]) => `• ${esc(catName.get(k) ?? 'Tanpa kategori')} — ${formatRupiah(v)}`)] : []),
  ]
  await sendMessage(ctx.chatId, lines.join('\n') + appLink('/keuangan'))
}

async function cmdWeekly(ctx: Ctx) {
  const today = todayIn(ctx.tz)
  const cur = addDays(today, -6), prev = addDays(today, -13)
  const fromIso = startOfDayIso(prev, ctx.tz), curIso = startOfDayIso(cur, ctx.tz)
  const [done, sess, notes, checks] = await Promise.all([
    ctx.db.from('tasks').select('completed_at').eq('user_id', ctx.userId).gte('completed_at', fromIso).limit(5000),
    ctx.db.from('learning_sessions').select('session_date, duration_minutes').eq('user_id', ctx.userId).gte('session_date', prev).limit(5000),
    ctx.db.from('journal_entries').select('entry_date').eq('user_id', ctx.userId).gte('entry_date', prev).limit(5000),
    ctx.db.from('habit_checkins').select('checkin_date').eq('user_id', ctx.userId).gte('checkin_date', prev).limit(10000),
  ])
  const split = <T,>(rows: T[] | null, isCur: (r: T) => boolean, w: (r: T) => number = () => 1) => {
    let c = 0, p = 0
    for (const r of rows ?? []) { if (isCur(r)) c += w(r); else p += w(r) }
    return { c, p }
  }
  const trend = (c: number, p: number) => (c > p ? '↑' : c < p ? '↓' : '→')
  const d = split(done.data, (r) => r.completed_at! >= curIso)
  const s = split(sess.data, (r) => r.session_date >= cur, (r) => r.duration_minutes)
  const n = split(notes.data, (r) => r.entry_date >= cur)
  const h = split(checks.data, (r) => r.checkin_date >= cur)
  const lines = [
    '📊 <b>Ringkasan 7 hari terakhir</b>', '<i>dibanding 7 hari sebelumnya</i>', '',
    `✅ Tugas selesai: <b>${formatNumber(d.c)}</b> ${trend(d.c, d.p)} (${formatNumber(d.p)})`,
    `📖 Waktu belajar: <b>${formatDuration(s.c)}</b> ${trend(s.c, s.p)} (${formatDuration(s.p)})`,
    `🗒 Catatan ditulis: <b>${formatNumber(n.c)}</b> ${trend(n.c, n.p)} (${formatNumber(n.p)})`,
    `🔁 Check-in kebiasaan: <b>${formatNumber(h.c)}</b> ${trend(h.c, h.p)} (${formatNumber(h.p)})`,
  ]
  await sendMessage(ctx.chatId, lines.join('\n') + appLink('/pencapaian', 'Lihat statistik lengkap'))
}

/* ---------- Pesan pengingat (dipakai cron) ---------- */
export function reminderText(t: { id: string; kind: string; title: string; due_at: string | null; start_at: string | null; end_at: string | null; location: string }, tz: string) {
  const at = anchorOf(t)
  const mins = at ? Math.round((new Date(at).getTime() - Date.now()) / 60_000) : null
  const rel = mins === null ? '' : mins <= 0 ? ' (sekarang)' : mins < 60 ? ` (${mins} menit lagi)` : ` (${formatDuration(mins)} lagi)`
  const head = t.kind === 'kegiatan' ? '📅 <b>Pengingat kegiatan</b>' : '⏰ <b>Pengingat tugas</b>'
  const when = t.kind === 'kegiatan'
    ? `Mulai ${formatShort(at!, tz)}${t.end_at ? `–${formatTime(t.end_at, tz)}` : ''}${rel}`
    : `${t.due_at ? 'Tenggat' : 'Mulai'} ${formatShort(at!, tz)}${rel}`
  return `${head}\n\n<b>${esc(t.title)}</b>\n${when}${t.location ? `\n📍 ${esc(t.location)}` : ''}` + appLink(`/tugas/${t.id}`, 'Buka tugas')
}
