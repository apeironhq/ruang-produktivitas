import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'

/** Catatan durasi per langkah dalam satu request webhook → header Server-Timing (untuk diagnosis kecepatan). */
const store = new AsyncLocalStorage<Array<[string, number]>>()

export const runTimed = <T>(fn: () => Promise<T>) => store.run([], fn)

export async function timed<T>(name: string, work: PromiseLike<T>): Promise<T> {
  const t = performance.now()
  try { return await work } finally { store.getStore()?.push([name, performance.now() - t]) }
}

export function serverTiming(totalMs: number) {
  const marks = store.getStore() ?? []
  return [...marks.map(([n, d], i) => `${n.replace(/[^\w.-]/g, '_')}${i};dur=${d.toFixed(0)}`), `total;dur=${totalMs.toFixed(0)}`].join(', ')
}
