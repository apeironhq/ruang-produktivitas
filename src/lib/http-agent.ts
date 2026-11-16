import 'server-only'
import { Agent, setGlobalDispatcher } from 'undici'

/*
 * Koneksi HTTP keep-alive lebih lama untuk fetch() di server (Telegram & Supabase).
 * Bawaan Node menutup koneksi menganggur setelah ±4 detik, sehingga tombol bot yang ditekan
 * dengan jeda lebih lama selalu membuka TLS baru — mahal ke server Telegram di Eropa.
 * Dipasang sekali per instance fungsi.
 */
const KEY = Symbol.for('ruang-produktivitas.keepalive')
const g = globalThis as unknown as Record<symbol, boolean>
if (!g[KEY]) {
  g[KEY] = true
  try {
    setGlobalDispatcher(new Agent({ keepAliveTimeout: 30_000, keepAliveMaxTimeout: 60_000, connections: 64, pipelining: 1 }))
  } catch (e) {
    console.error('keep-alive agent', e)
  }
}
