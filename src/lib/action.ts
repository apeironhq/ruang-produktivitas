import { z } from 'zod'
import { parseIdNumber } from './format'

/** Hasil Server Action yang dibaca form (useActionState). */
export type ActionState = {
  ok: boolean
  message: string
  errors?: Record<string, string>
  /** id baris yang dibuat (mis. untuk navigasi) */
  id?: string
  /** penanda unik agar efek klien (toast/tutup modal) terpicu setiap submit */
  ts: number
  /** tampilkan pesan sukses walau aksinya biasanya senyap (mis. lencana baru dari check-in) */
  notify?: boolean
} | null

type Result = NonNullable<ActionState>
export const ok = (message: string, id?: string): Result => ({ ok: true, message, id, ts: Date.now() })
export const fail = (message: string, errors?: Record<string, string>): Result => ({ ok: false, message, errors, ts: Date.now() })

/** Validasi FormData dengan Zod; kesalahan dipetakan per nama field. */
export function parseForm<T extends z.ZodType>(schema: T, formData: FormData):
  { data: z.infer<T>; error?: undefined } | { data?: undefined; error: Result } {
  const raw: Record<string, unknown> = {}
  for (const key of new Set(formData.keys())) {
    if (key.startsWith('$ACTION')) continue
    const all = formData.getAll(key)
    raw[key] = all.length > 1 ? all : all[0]
  }
  const result = schema.safeParse(raw)
  if (result.success) return { data: result.data }
  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const k = String(issue.path[0] ?? '_')
    if (!errors[k]) errors[k] = issue.message
  }
  return { error: fail('Periksa kembali isian yang ditandai.', errors) }
}

/** Pesan kesalahan database yang aman ditampilkan (tanpa membocorkan detail internal). */
export function dbError(error: { code?: string; message?: string } | null, fallback = 'Gagal menyimpan data. Coba lagi.'): Result {
  if (!error) return fail(fallback)
  switch (error.code) {
    case '23503': return fail('Data yang ditautkan tidak ditemukan atau bukan milik Anda.')
    case '23505': return fail('Data yang sama sudah ada.')
    case '23514': return fail('Isian tidak memenuhi aturan. Periksa kembali nilainya.')
    case '42501': return fail('Akses ditolak.')
    case 'PGRST116': return fail('Data tidak ditemukan.')
    default:
      console.error('[db]', error.code, error.message)
      return fail(fallback)
  }
}

// ---- Skema field umum ----
const blankToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)

export const zText = (max: number, label = 'Isian') =>
  z.string({ error: `${label} wajib diisi.` }).trim().min(1, `${label} wajib diisi.`).max(max, `${label} maksimal ${max} karakter.`)

export const zOptText = (max: number) =>
  z.preprocess((v) => (v == null ? '' : v), z.string().trim().max(max, `Maksimal ${max} karakter.`))

export const zOptUuid = z.preprocess(blankToUndef, z.uuid('Pilihan tidak valid.').optional()).transform((v) => v ?? null)

export const zUuid = z.uuid('Data tidak valid.')

export const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal tidak valid.')
export const zOptDay = z.preprocess(blankToUndef, zDay.optional()).transform((v) => v ?? null)

export const zOptLocalDateTime = z
  .preprocess(blankToUndef, z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Waktu tidak valid.').optional())
  .transform((v) => v ?? null)

export const zNumber = (label = 'Nilai') =>
  z.preprocess((v) => parseIdNumber(v) ?? undefined, z.number({ error: `${label} harus berupa angka.` })
    .refine((n) => Math.abs(n) < 1e16, `${label} terlalu besar.`))

export const zInt = (min: number, max: number, label = 'Nilai') =>
  z.preprocess((v) => parseIdNumber(v) ?? undefined, z.number({ error: `${label} harus berupa angka.` })
    .int(`${label} harus bilangan bulat.`).min(min, `${label} minimal ${min}.`).max(max, `${label} maksimal ${max}.`))

export const zCheckbox = z.preprocess((v) => v === 'on' || v === 'true' || v === '1', z.boolean())

export const zEnum = <T extends readonly [string, ...string[]]>(values: T, label = 'Pilihan') =>
  z.enum(values, { error: `${label} tidak valid.` })
