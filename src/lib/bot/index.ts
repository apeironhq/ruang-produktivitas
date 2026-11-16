import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_TZ, isValidTimeZone, todayIn } from '../dates'
import { answerCallback, editMessageCaption, editMessageKb, sendMessage, sendMessageKb, sendPhoto, type Keyboard } from '../telegram'
import { clearFlow, continueFlow, loadPending, startFlow, type FlowState } from './flows'
import {
  badgesPanel, calendarPanel, catatPanel, financePanel, goalDetailPanel, goalsPanel, habitsPanel, helpPanel, homePanel, journalDetailPanel,
  journalPanel, learningPanel, projectDetailPanel, projectsPanel, remindersPanel, settingsPanel, taskDetailPanel, tasksPanel, weeklyPanel,
} from './panels'
import { btn, cut, esc, link, renderPanel, siteUrl, type Ctx, type Panel } from './ui'

export { reminderKeyboard, reminderText } from './panels'
export { siteUrl }

/* ---------- Tipe minimal update Telegram ---------- */
interface TgUser { id: number; username?: string; first_name?: string }
interface TgMessage { message_id: number; chat: { id: number; type: string }; from?: TgUser; text?: string; photo?: unknown[] }
interface TgCallback { id: string; from: TgUser; data?: string; message?: TgMessage }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback }

const bannerUrl = () => `${siteUrl()}/bot/header.jpg`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function loadCtx(db: SupabaseClient, telegramUserId: number, chatId: number): Promise<Ctx | null> {
  const { data: conn } = await db.from('telegram_connections').select('user_id, chat_id').eq('telegram_user_id', telegramUserId).maybeSingle()
  if (!conn) return null
  const { data: prof } = await db.from('profiles').select('display_name, timezone').eq('id', conn.user_id).maybeSingle()
  const tz = prof?.timezone && isValidTimeZone(prof.timezone) ? prof.timezone : DEFAULT_TZ
  if (Number(conn.chat_id) !== chatId) await db.from('telegram_connections').update({ chat_id: chatId }).eq('user_id', conn.user_id)
  return { db, chatId, userId: conn.user_id, tz, name: prof?.display_name || 'Kamu' }
}

/* ---------- Tampilkan panel ---------- */
async function sendPanel(chatId: number, p: Panel) {
  return sendMessageKb(chatId, renderPanel(p, 4000), p.kb)
}
/** Ganti isi pesan yang tombolnya ditekan (foto → keterangan maks. 1024, teks → teks). Gagal → pesan baru. */
async function showPanel(ctx: Ctx, p: Panel, msg?: TgMessage) {
  if (msg) {
    const r = msg.photo
      ? await editMessageCaption(ctx.chatId, msg.message_id, renderPanel(p, 1024), p.kb)
      : await editMessageKb(ctx.chatId, msg.message_id, renderPanel(p, 4000), p.kb)
    if (r.ok || /not modified/i.test(r.error)) return
  }
  await sendPanel(ctx.chatId, p)
}

/** Pesan beranda: banner + ringkasan hari ini + menu. Foto gagal → versi teks. */
export async function sendDashboard(ctx: Pick<Ctx, 'db' | 'chatId' | 'userId' | 'tz' | 'name'>, note?: string) {
  const p = await homePanel(ctx, note)
  const res = await sendPhoto(ctx.chatId, bannerUrl(), renderPanel(p, 1024), p.kb)
  if (res.ok) return res
  console.error('kirim banner ditolak Telegram:', res.error)
  return sendMessageKb(ctx.chatId, renderPanel(p, 4000), p.kb)
}

/* ---------- Selamat datang ---------- */
const FEATURES = [
  '✅ Tugas & kegiatan + pengingat otomatis',
  '📅 Agenda & ringkasan setiap pagi',
  '💰 Catat pemasukan & pengeluaran',
  '📚 Sesi belajar · 🗒 catatan & jurnal',
  '🎯 Target · 🔁 kebiasaan · 🏆 lencana',
]
async function sendWelcome(chatId: number) {
  const p: Panel = {
    head: ['🐰 <b>Selamat datang di Rupi!</b>', '<i>Asisten Produktivitas Pribadimu dari Ruang Produktivitas.</i>'],
    sections: [
      { title: '✨ Yang bisa Rupi bantu', quote: true, lines: FEATURES },
      { title: '🔗 Tautkan akunmu dulu', quote: true, lines: ['1. Buka <b>Pengaturan → Bot Telegram</b> di aplikasi', '2. Tekan <b>Buat kode tautan</b>', '3. Tekan <b>Buka di Telegram</b>, atau kirim <code>/mulai KODE</code> ke sini'] },
    ],
    foot: ['<i>Data hanya bisa diakses dari akun yang sudah ditautkan.</i>'],
    kb: [[link('🌐 Buka Pengaturan', '/pengaturan', 'primary')]],
  }
  const res = await sendPhoto(chatId, bannerUrl(), renderPanel(p, 1024), p.kb)
  if (!res.ok) await sendMessageKb(chatId, renderPanel(p, 4000), p.kb)
}

/* ---------- Penautan (BT-01) ---------- */
async function linkAccount(db: SupabaseClient, chatId: number, from: TgUser, raw: string) {
  const code = raw.trim().toUpperCase()
  if (!/^[A-Z0-9]{6}$/.test(code)) { await sendMessage(chatId, '⚠️ Kode tautan terdiri dari <b>6 huruf/angka</b>. Buat kode baru di <b>Pengaturan → Bot Telegram</b>.'); return 'selesai' as const }
  // Klaim kode secara atomik: hanya berhasil sekali & selama belum kedaluwarsa.
  const { data: claimed } = await db.from('telegram_link_codes').update({ used_at: new Date().toISOString() })
    .eq('code', code).is('used_at', null).gt('expires_at', new Date().toISOString()).select('user_id').maybeSingle()
  if (!claimed) { await sendMessage(chatId, '❌ <b>Kode tidak valid</b>, sudah dipakai, atau kedaluwarsa (berlaku 10 menit). Buat kode baru di Pengaturan.'); return 'selesai' as const }
  const { data: other } = await db.from('telegram_connections').select('user_id').eq('telegram_user_id', from.id).maybeSingle()
  if (other && other.user_id !== claimed.user_id) { await sendMessage(chatId, '⚠️ Akun Telegram ini sudah tertaut ke akun Ruang Produktivitas lain. Kirim /putus dulu dari akun tersebut.'); return 'selesai' as const }
  const { error } = await db.from('telegram_connections').upsert(
    { user_id: claimed.user_id, telegram_user_id: from.id, chat_id: chatId, username: (from.username ?? from.first_name ?? '').slice(0, 64), linked_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )
  if (error) throw error
  const ctx = await loadCtx(db, from.id, chatId)
  if (!ctx) return 'selesai' as const
  // Langsung ke ringkasan dashboard, dengan satu baris sambutan.
  await sendDashboard(ctx, '🎉 <b>Akun berhasil ditautkan!</b> <i>Pengingat & ringkasan harian akan dikirim ke sini.</i>')
  return 'selesai' as const
}

/* ---------- Pesan masuk ---------- */
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

  if ((name === 'start' || name === 'mulai') && arg) return linkAccount(db, chatId, m.from, arg)

  const ctx = await loadCtx(db, m.from.id, chatId)
  // UJ-08: akun Telegram yang belum ditautkan tidak bisa membaca/menulis data apa pun.
  if (!ctx) { await sendWelcome(chatId); return 'selesai' }

  const pend = await loadPending(ctx)
  if (!cmd) {
    if (pend?.action === 'alur') { await continueFlow(ctx, pend.payload as FlowState, { text }, null); return 'selesai' }
    await offerFreeText(ctx, text)
    return 'selesai'
  }
  if (pend) await clearFlow(ctx) // perintah baru membatalkan isian yang sedang berjalan

  switch (name) {
    case 'start': case 'mulai': case 'menu': await sendDashboard(ctx); break
    case 'bantuan': case 'help': await sendPanel(chatId, helpPanel()); break
    case 'tugas': await sendPanel(chatId, await tasksPanel(ctx)); break
    case 'kalender': await sendPanel(chatId, await calendarPanel(ctx)); break
    case 'proyek': await sendPanel(chatId, await projectsPanel(ctx)); break
    case 'target': await sendPanel(chatId, await goalsPanel(ctx)); break
    case 'keuangan': case 'uang': await sendPanel(chatId, await financePanel(ctx)); break
    case 'jurnal': await sendPanel(chatId, await journalPanel(ctx)); break
    case 'kebiasaan': await sendPanel(chatId, await habitsPanel(ctx)); break
    case 'pencapaian': case 'lencana': await sendPanel(chatId, await badgesPanel(ctx)); break
    case 'ringkasan': await sendPanel(chatId, await weeklyPanel(ctx)); break
    case 'pengingat': await sendPanel(chatId, await remindersPanel(ctx)); break
    case 'pengaturan': await sendPanel(chatId, await settingsPanel(ctx)); break
    case 'tambah': await startFlow(ctx, 'tugas', arg, null); break
    case 'kegiatan': await startFlow(ctx, 'kegiatan', arg, null); break
    case 'catat': await startFlow(ctx, 'catatan', arg, null); break
    case 'belajar': await startFlow(ctx, 'sesi', arg, null); break
    case 'keluar': await startFlow(ctx, 'keluar', arg, null); break
    case 'masuk': await startFlow(ctx, 'masuk', arg, null); break
    case 'batal': await sendMessageKb(chatId, pend ? '✖️ <i>Isian dibatalkan.</i>' : '<i>Tidak ada isian yang sedang berjalan.</i>', [[btn('🏠 Menu', 'p:home')]]); break
    case 'putus': await sendPanel(chatId, unlinkConfirm()); break
    default: await sendPanel(chatId, { ...helpPanel(), head: ['⚠️ <b>Perintah tidak dikenal.</b>', '<i>Ini daftar perintah yang tersedia:</i>'] })
  }
  return 'selesai'
}

/** Pesan bebas → tawarkan disimpan sebagai catatan / tugas / pengeluaran (BT-04: tidak langsung disimpan). */
async function offerFreeText(ctx: Ctx, text: string) {
  const body = text.slice(0, 50000)
  await ctx.db.from('telegram_pending').upsert({ chat_id: ctx.chatId, user_id: ctx.userId, action: 'teks', payload: { text: body }, created_at: new Date().toISOString() })
  const looksMoney = /^\s*(rp\s*)?[\d.,]+\s*(rb|ribu|k|jt|juta)?\b/i.test(text)
  await sendMessageKb(ctx.chatId, [
    '💬 <b>Pesan diterima</b>',
    `<blockquote expandable>${esc(body.length > 700 ? `${body.slice(0, 700)}…` : body)}</blockquote>`,
    '<i>Mau disimpan sebagai apa?</i>',
  ].join('\n'), [
    [btn('🗒 Catatan', 'q:catat'), btn('✅ Tugas', 'q:tugas')],
    ...(looksMoney ? [[btn('💸 Pengeluaran', 'q:keluar'), btn('💵 Pemasukan', 'q:masuk')]] : []),
    [btn('✖️ Abaikan', 'q:x')],
  ])
}

function unlinkConfirm(): Panel {
  return {
    head: ['🔌 <b>Putuskan bot dari akun?</b>'],
    sections: [{ quote: true, lines: ['Rupi tidak bisa lagi membaca atau menambah datamu, dan pengingat berhenti dikirim.', '<i>Kamu bisa menautkan lagi kapan saja dari Pengaturan.</i>'] }],
    kb: [[btn('🔌 Ya, putuskan', 'set:putus:ya', 'danger'), btn('Batal', 'p:atur')]],
  }
}

/* ---------- Tombol ---------- */
const LEGACY: Record<string, string> = {
  'm:catat': 'p:catat', 'm:tugas': 'p:tugas', 'm:belajar': 'p:belajar', 'm:target': 'p:target', 'm:uang': 'p:uang', 'm:ringkas': 'p:ringkas',
  'b:home': 'p:home', 'c:catatan': 'f:catatan', 'c:tugas': 'f:tugas', 'c:belajar': 'f:sesi',
}
const STATUS: Record<string, string> = { s: 'selesai', b: 'belum', k: 'dikerjakan', t: 'tertunda', x: 'dibatalkan' }

async function handleCallback(db: SupabaseClient, cb: TgCallback): Promise<'selesai' | 'diabaikan'> {
  const msg = cb.message
  if (!msg || msg.chat.type !== 'private') { await answerCallback(cb.id); return 'diabaikan' }
  const ctx = await loadCtx(db, cb.from.id, msg.chat.id)
  if (!ctx) { await answerCallback(cb.id, 'Akun belum ditautkan.'); return 'selesai' }
  const data = LEGACY[cb.data ?? ''] ?? cb.data ?? ''
  const edit = { id: msg.message_id, photo: !!msg.photo }
  const [kind, ...restParts] = data.split(':')
  const rest = restParts.join(':')
  let toast: string | undefined

  switch (kind) {
    case 'w': { // jawaban isian bertahap
      const pend = await loadPending(ctx)
      if (pend?.action !== 'alur') { toast = 'Isian ini sudah tidak aktif.'; break }
      await answerCallback(cb.id)
      await continueFlow(ctx, pend.payload as FlowState, { choice: rest }, edit)
      return 'selesai'
    }
    case 'q': { // pilihan untuk pesan bebas
      const pend = await loadPending(ctx)
      const text = pend?.action === 'teks' ? String((pend.payload as { text?: string }).text ?? '') : ''
      if (!text) { toast = 'Pesan ini sudah tidak aktif.'; break }
      await answerCallback(cb.id)
      if (rest === 'x') { await clearFlow(ctx); await editMessageKb(ctx.chatId, msg.message_id, '✖️ <i>Pesan diabaikan.</i>', [[btn('🏠 Menu', 'p:home')]]); return 'selesai' }
      const flow = rest === 'catat' ? 'catatan' : rest === 'tugas' ? 'tugas' : rest === 'keluar' || rest === 'masuk' ? rest : null
      if (flow) await startFlow(ctx, flow, flow === 'tugas' ? (text.split('\n')[0] ?? '').slice(0, 200) : text, edit)
      return 'selesai'
    }
    case 'f': { // mulai isian (f:tugas, f:tp:<proyek>, f:prog:<target>, f:sub:<tugas>, ...)
      await answerCallback(cb.id)
      await clearFlow(ctx)
      const [name, arg = ''] = rest.split(':')
      if (name === 'tp') await startFlow(ctx, 'tugas', `tp:${arg}`, edit)
      else await startFlow(ctx, name!, arg, edit)
      return 'selesai'
    }
    case 'p': {
      await answerCallback(cb.id)
      if (rest === 'home' && !msg.photo) { await sendDashboard(ctx); return 'selesai' }
      const p = await panelFor(ctx, rest)
      if (p) await showPanel(ctx, p, msg)
      return 'selesai'
    }
    case 'td': case 'pj': case 'gl': case 'jn': {
      if (!UUID.test(rest)) break
      const p = kind === 'td' ? await taskDetailPanel(ctx, rest) : kind === 'pj' ? await projectDetailPanel(ctx, rest) : kind === 'gl' ? await goalDetailPanel(ctx, rest) : await journalDetailPanel(ctx, rest)
      if (!p) { toast = 'Data tidak ditemukan (mungkin sudah dihapus).'; break }
      await answerCallback(cb.id)
      await showPanel(ctx, p, msg)
      return 'selesai'
    }
    case 'ts': { // ubah status tugas/kegiatan
      const [code, id] = rest.split(':')
      const status = STATUS[code ?? '']
      if (!status || !id || !UUID.test(id)) break
      const { data: t } = await db.from('tasks').update({ status }).eq('id', id).eq('user_id', ctx.userId).select('recurrence').maybeSingle()
      if (!t) { toast = 'Tugas tidak ditemukan.'; break }
      if (status === 'selesai') await db.rpc('evaluate_achievements_for', { p_user: ctx.userId })
      toast = status === 'selesai' ? (t.recurrence !== 'tidak' ? '✅ Selesai! Jadwal berikutnya sudah dibuat.' : '✅ Selesai! Kerja bagus 🎉') : `Status: ${status}`
      const p = await taskDetailPanel(ctx, id)
      await answerCallback(cb.id, toast)
      if (p) await showPanel(ctx, p, msg)
      return 'selesai'
    }
    case 'sx': { // centang subtugas
      if (!UUID.test(rest)) break
      const { data: s } = await db.from('task_subtasks').select('task_id, is_completed').eq('id', rest).eq('user_id', ctx.userId).maybeSingle()
      if (!s) { toast = 'Subtugas tidak ditemukan.'; break }
      await db.from('task_subtasks').update({ is_completed: !s.is_completed }).eq('id', rest).eq('user_id', ctx.userId)
      await answerCallback(cb.id, s.is_completed ? 'Subtugas dibuka lagi' : '☑️ Subtugas selesai')
      const p = await taskDetailPanel(ctx, s.task_id)
      if (p) await showPanel(ctx, p, msg)
      return 'selesai'
    }
    case 'ms': { // centang tahapan proyek
      if (!UUID.test(rest)) break
      const { data: m } = await db.from('project_milestones').select('project_id, completed_at').eq('id', rest).eq('user_id', ctx.userId).maybeSingle()
      if (!m) { toast = 'Tahapan tidak ditemukan.'; break }
      await db.from('project_milestones').update({ completed_at: m.completed_at ? null : new Date().toISOString() }).eq('id', rest).eq('user_id', ctx.userId)
      await answerCallback(cb.id, m.completed_at ? 'Tahapan dibuka lagi' : '🏁 Tahapan selesai')
      const p = await projectDetailPanel(ctx, m.project_id)
      if (p) await showPanel(ctx, p, msg)
      return 'selesai'
    }
    case 'hb': { // check-in kebiasaan hari ini
      if (!UUID.test(rest)) break
      const { data: h } = await db.from('habits').select('id, name').eq('id', rest).eq('user_id', ctx.userId).maybeSingle()
      if (!h) { toast = 'Kebiasaan tidak ditemukan.'; break }
      const today = todayIn(ctx.tz)
      const { data: removed } = await db.from('habit_checkins').delete().eq('habit_id', rest).eq('user_id', ctx.userId).eq('checkin_date', today).select('id')
      let badges = 0
      if (!removed?.length) {
        await db.from('habit_checkins').insert({ user_id: ctx.userId, habit_id: rest, checkin_date: today })
        const { data: n } = await db.rpc('evaluate_achievements_for', { p_user: ctx.userId })
        badges = Number(n ?? 0)
      }
      await answerCallback(cb.id, removed?.length ? `Check-in ${h.name} dibatalkan` : badges ? `🏆 Check-in tercatat + ${badges} lencana baru!` : `✅ Check-in ${h.name} tercatat`)
      await showPanel(ctx, await habitsPanel(ctx), msg)
      return 'selesai'
    }
    case 'd': { // "Tandai selesai" dari pesan pengingat
      if (!UUID.test(rest)) break
      const { data: t } = await db.from('tasks').update({ status: 'selesai' }).eq('id', rest).eq('user_id', ctx.userId).eq('kind', 'tugas').select('title').maybeSingle()
      if (!t) { toast = 'Tugas tidak ditemukan.'; break }
      await db.rpc('evaluate_achievements_for', { p_user: ctx.userId })
      await answerCallback(cb.id, '✅ Ditandai selesai')
      await editMessageKb(ctx.chatId, msg.message_id, `✅ <b>Selesai!</b>\n<blockquote><s>${cut(t.title, 80)}</s></blockquote>\n<i>Kerja bagus! 🎉</i>`, [[btn('🏠 Menu', 'p:home'), btn('✅ Tugas lain', 'p:tugas')]])
      return 'selesai'
    }
    case 'set': {
      const ok = await applySetting(ctx, rest)
      if (ok === 'putus') {
        await answerCallback(cb.id, 'Bot diputus')
        await editMessageKb(ctx.chatId, msg.message_id, '🔌 <b>Bot sudah diputus dari akunmu.</b>\n<i>Pengingat tidak dikirim lagi. Tautkan kembali kapan saja dari Pengaturan.</i>', [[link('🌐 Buka Pengaturan', '/pengaturan')]])
        return 'selesai'
      }
      if (ok === 'konfirmasi') { await answerCallback(cb.id); await showPanel(ctx, unlinkConfirm(), msg); return 'selesai' }
      await answerCallback(cb.id, ok ? 'Pengaturan disimpan ✅' : undefined)
      await showPanel(ctx, await settingsPanel(ctx), msg)
      return 'selesai'
    }
    case 'ya': case 'batal': toast = 'Konfirmasi ini sudah tidak berlaku.'; break
  }
  await answerCallback(cb.id, toast)
  return 'selesai'
}

async function panelFor(ctx: Ctx, name: string): Promise<Panel | null> {
  switch (name) {
    case 'home': return homePanel(ctx)
    case 'catat': return catatPanel()
    case 'tugas': return tasksPanel(ctx)
    case 'kal': return calendarPanel(ctx)
    case 'proyek': return projectsPanel(ctx)
    case 'target': return goalsPanel(ctx)
    case 'uang': return financePanel(ctx)
    case 'belajar': return learningPanel(ctx)
    case 'jurnal': return journalPanel(ctx)
    case 'habit': return habitsPanel(ctx)
    case 'lencana': return badgesPanel(ctx)
    case 'ringkas': return weeklyPanel(ctx)
    case 'atur': return settingsPanel(ctx)
    case 'ingat': return remindersPanel(ctx)
    case 'bantuan': return helpPanel()
    default: return null
  }
}

async function applySetting(ctx: Ctx, what: string): Promise<boolean | 'putus' | 'konfirmasi'> {
  if (what === 'putus') return 'konfirmasi'
  if (what === 'putus:ya') {
    await ctx.db.from('telegram_pending').delete().eq('user_id', ctx.userId)
    await ctx.db.from('telegram_connections').delete().eq('user_id', ctx.userId)
    return 'putus'
  }
  const { data: prof } = await ctx.db.from('profiles').select('notification_settings').eq('id', ctx.userId).maybeSingle()
  const ns = { ...((prof?.notification_settings as Record<string, unknown>) ?? {}) }
  if (what === 'dg') ns.digest = ns.digest === false
  else if (/^dt:(0[5-9]|1\d|2[0-2])$/.test(what)) { ns.digest_time = `${what.slice(3)}:00`; ns.digest = true }
  else return false
  const { error } = await ctx.db.from('profiles').update({ notification_settings: ns }).eq('id', ctx.userId)
  return !error
}

export type { Keyboard }
