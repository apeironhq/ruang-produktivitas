'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { dbError, fail, ok, parseForm, zDay, zEnum, zInt, zOptText, zOptUuid, zText, zUuid, type ActionState } from '@/lib/action'
import { createClient } from '@/lib/supabase/server'

function revalidateHabits() {
  revalidatePath('/kebiasaan')
  revalidatePath('/pencapaian')
  revalidatePath('/')
}

export async function saveHabit(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({
    id: zOptUuid,
    name: zText(80, 'Nama kebiasaan'),
    description: zOptText(500),
    frequency: zEnum(['harian', 'mingguan'] as const, 'Frekuensi'),
    times_per_week: z.preprocess((v) => (v === '' || v == null ? '7' : v), zInt(1, 7, 'Kali per minggu')),
  }), formData)
  if (parsed.error) return parsed.error
  const { id, ...v } = parsed.data
  const row = { ...v, times_per_week: v.frequency === 'harian' ? 7 : v.times_per_week }
  const supabase = await createClient()
  const { error } = id ? await supabase.from('habits').update(row).eq('id', id) : await supabase.from('habits').insert(row)
  if (error) return dbError(error)
  revalidateHabits()
  return ok(id ? 'Kebiasaan diperbarui.' : 'Kebiasaan ditambahkan.')
}

/** Check-in / batalkan check-in pada tanggal tertentu, lalu evaluasi lencana (idempoten). */
export async function setCheckin(habitId: string, day: string, done: boolean): Promise<ActionState> {
  const p = z.object({ habitId: zUuid, day: zDay }).safeParse({ habitId, day })
  if (!p.success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = done
    ? await supabase.from('habit_checkins').upsert({ habit_id: habitId, checkin_date: day }, { onConflict: 'user_id,habit_id,checkin_date', ignoreDuplicates: true })
    : await supabase.from('habit_checkins').delete().eq('habit_id', habitId).eq('checkin_date', day)
  if (error) return dbError(error)
  let newBadges = 0
  if (done) {
    const { data } = await supabase.rpc('evaluate_achievements')
    newBadges = Number(data ?? 0)
  }
  revalidateHabits()
  if (newBadges > 0) return { ok: true, message: `Lencana baru diraih! Lihat di Pencapaian.`, notify: true, ts: Date.now() }
  return ok(done ? 'Check-in tercatat.' : 'Check-in dibatalkan.')
}

export async function setHabitArchived(id: string, archived: boolean): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('habits').update({ is_archived: archived }).eq('id', id)
  if (error) return dbError(error)
  revalidateHabits()
  return ok(archived ? 'Kebiasaan diarsipkan.' : 'Kebiasaan diaktifkan kembali.')
}

export async function deleteHabit(id: string): Promise<ActionState> {
  if (!zUuid.safeParse(id).success) return fail('Data tidak valid.')
  const supabase = await createClient()
  const { error } = await supabase.from('habits').delete().eq('id', id)
  if (error) return dbError(error)
  revalidateHabits()
  return ok('Kebiasaan dan riwayat check-in-nya dihapus.')
}
