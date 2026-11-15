// Menerapkan migrasi di supabase/migrations yang belum tercatat, satu transaksi per file.
// Kompatibel dengan Supabase CLI (memakai tabel supabase_migrations.schema_migrations).
// Pemakaian: npm run db:migrate            → terapkan yang tertunda
//            npm run db:migrate -- --status → hanya tampilkan status
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

try { process.loadEnvFile('.env.local') } catch { /* env bisa datang dari shell / CI */ }
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL belum diisi di .env.local (pakai Session Pooler, port 5432).')
  process.exit(1)
}

const dir = join(process.cwd(), 'supabase', 'migrations')
const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
await client.query(`create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`)
const { rows } = await client.query('select version from supabase_migrations.schema_migrations')
const applied = new Set(rows.map((r) => r.version))
const pending = files.filter((f) => !applied.has(f.split('_')[0]))

for (const f of files) console.log(`${applied.has(f.split('_')[0]) ? '✓ sudah' : '• tertunda'}  ${f}`)
if (process.argv.includes('--status') || pending.length === 0) {
  if (!pending.length) console.log('\nTidak ada migrasi tertunda.')
  await client.end()
  process.exit(0)
}

for (const f of pending) {
  const [version, ...rest] = f.replace(/\.sql$/, '').split('_')
  const sql = readFileSync(join(dir, f), 'utf8')
  await client.query('begin')
  try {
    await client.query(sql)
    await client.query('insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)', [version, rest.join('_')])
    await client.query('commit')
    console.log(`\nDiterapkan: ${f}`)
  } catch (e) {
    await client.query('rollback')
    console.error(`\nGagal (dibatalkan): ${f}\n  ${e.message}`)
    await client.end()
    process.exit(1)
  }
}
await client.query(`notify pgrst, 'reload schema'`)
await client.end()
