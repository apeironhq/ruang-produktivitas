import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_TZ, isValidTimeZone, startOfDayIso, todayIn, addDays } from './dates'
import { formatDuration, formatShort, formatTime } from './format'
import { GOAL_COLUMNS, mergeProgress } from './queries'
import type { Goal, GoalProgressRow } from './types'
import { answerCallback, editMessage, esc, sendMessage } from './telegram'

/* ---------- Tipe minimal update Telegram ---------- */
interface TgUser { id: number; username?: string; first_name?: string }
interface TgMessage { message_id: number; chat: { id: number; type: string }; from?: TgUser; text?: string }
interface TgCallback { id: string; from: TgUser; data?: string; message?: TgMessage }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback }

interface Ctx { db: SupabaseClient; chatId: number; userId: string; tz: string; name: string }

const OPEN = ['belum', 'dikerjakan', 'tertunda']
export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')
const appLink = (path: string, label = 'Buka di aplikasi') => (siteUrl() ? `\n\n<a href="${siteUrl()}${path}">${label}</a>` : '')

const HELP = [
  '<b>Perintah Ruang Produktivitas</b>',
  '/tugas — tugas & kegiatan hari ini',
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
    case 'start': case 'mulai': await sendMessage(chatId, `Akun sudah tertaut sebagai <b>${esc(ctx.name)}</b>.\n\n${HELP}`); break
    case 'bantuan': case 'help': await sendMessage(chatId, HELP); break
    case 'tugas': await cmdTasks(ctx); break
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
  const { data: prof } = await db.from('profiles').select('display_name').eq('id', claimed.user_id).maybeSingle()
  await sendMessage(chatId, `✅ Tertaut dengan akun <b>${esc(prof?.display_name || 'Anda')}</b>. Pengingat tugas & ringkasan harian akan dikirim ke sini.\n\n${HELP}`)
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
