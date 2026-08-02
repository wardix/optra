#!/usr/bin/env bun
/**
 * OPTRA LOS Export CLI Tool
 *
 * Mengekspor circuit_id dan homepass_id untuk ONT yang mengalami LOS
 * (Loss of Signal) dengan last_down_time dalam periode tertentu.
 *
 * Sumber data : ont_current_status
 * Filter      : last_down_cause = 'los', last_down_time dalam rentang --from s.d --to
 *
 * Dengan --live-check:
 *   Sebelum export, setiap ONT dicek live ke API Protelindo.
 *   Hanya ONT yang masih offline LOS setelah live check yang akan dieksport.
 *
 * Contoh:
 *   bun run src/los-export.ts --from "2026-08-01 00:00:00" --to "2026-08-02 23:59:59"
 *   bun run src/los-export.ts --from "2026-08-01 00:00:00" --to "2026-08-02 23:59:59" --live-check
 *   bun run src/los-export.ts --from "2026-08-01 00:00:00" --to "2026-08-02 23:59:59" --live-check --concurrency 5 --delay 500
 *   bun run src/los-export.ts --from "2026-08-01 00:00:00" --to "2026-08-02 23:59:59" --output hasil_los.csv
 */

import { TelemetryDatabase } from './database'
import { ProtelindoAuthManager } from './protelindo'

// ─── Parse CLI Arguments ──────────────────────────────────────────────────────

function parseArgs(): {
  fromMs: number
  toMs: number
  outputFile: string | null
  liveCheck: boolean
  concurrency: number
  delayMs: number
} {
  const args = process.argv.slice(2)
  let fromMs: number | null = null
  let toMs: number | null = null
  let outputFile: string | null = null
  let liveCheck = false
  let concurrency = 3
  let delayMs = 1000

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--from': {
        const raw = args[++i] || ''
        const parsed = Date.parse(raw.replace(' ', 'T') + '+07:00')
        if (isNaN(parsed)) {
          console.error(`❌ Format --from tidak valid: "${raw}". Gunakan: YYYY-MM-DD HH:mm:ss`)
          process.exit(1)
        }
        fromMs = parsed
        break
      }
      case '--to': {
        const raw = args[++i] || ''
        const parsed = Date.parse(raw.replace(' ', 'T') + '+07:00')
        if (isNaN(parsed)) {
          console.error(`❌ Format --to tidak valid: "${raw}". Gunakan: YYYY-MM-DD HH:mm:ss`)
          process.exit(1)
        }
        toMs = parsed
        break
      }
      case '--output':
        outputFile = args[++i] || null
        break
      case '--live-check':
        liveCheck = true
        break
      case '--concurrency':
        concurrency = parseInt(args[++i] || '3', 10)
        break
      case '--delay':
        delayMs = parseInt(args[++i] || '1000', 10)
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
    }
  }

  if (fromMs === null || toMs === null) {
    console.error('❌ Parameter --from dan --to wajib diisi.')
    console.error(
      '   Contoh: bun run src/los-export.ts --from "2026-08-01 00:00:00" --to "2026-08-02 23:59:59"',
    )
    process.exit(1)
  }

  if (fromMs > toMs) {
    console.error('❌ Nilai --from tidak boleh lebih besar dari --to.')
    process.exit(1)
  }

  return { fromMs, toMs, outputFile, liveCheck, concurrency, delayMs }
}

function printHelp() {
  console.log(`
📡 OPTRA LOS Export CLI Tool

PENGGUNAAN:
  bun run src/los-export.ts [opsi]

OPSI WAJIB:
  --from <datetime>    Awal periode last_down_time (WIB). Format: YYYY-MM-DD HH:mm:ss
  --to   <datetime>    Akhir periode last_down_time (WIB). Format: YYYY-MM-DD HH:mm:ss

OPSI OPSIONAL:
  --live-check         Lakukan live check ke API Protelindo sebelum export.
                       Hanya ONT yang masih LOS setelah live check yang dieksport.
  --concurrency <n>    Jumlah worker paralel saat live check (default: 3)
  --delay <ms>         Jeda antar request live check dalam ms (default: 1000)
  --output <file>      Nama file CSV output (default: los_export_<timestamp>.csv)
  --help, -h           Tampilkan bantuan ini

CONTOH:
  # Export tanpa live check (berdasarkan data cache DB)
  bun run src/los-export.ts --from "2026-08-01 00:00:00" --to "2026-08-02 23:59:59"

  # Export dengan live check terlebih dahulu
  bun run src/los-export.ts --from "2026-08-01 00:00:00" --to "2026-08-02 23:59:59" --live-check

  # Live check dengan concurrency & delay custom
  bun run src/los-export.ts --from "2026-08-01 00:00:00" --to "2026-08-02 23:59:59" --live-check --concurrency 5 --delay 500

  # Dengan nama file output custom
  bun run src/los-export.ts --from "2026-08-01 00:00:00" --to "2026-08-02 23:59:59" --live-check --output hasil_los.csv
`)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function generateDefaultFilename(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `los_export_${ts}.csv`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const BLUE = '\x1b[34m'
const MAGENTA = '\x1b[35m'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LosTarget {
  subscriber_id: number
  circuit_id: string
  homepass_id: string
}

// ─── Query DB ─────────────────────────────────────────────────────────────────

async function fetchLosTargets(fromMs: number, toMs: number): Promise<LosTarget[]> {
  const { sql } = await import('bun')

  const DATABASE_URL = Bun.env.DATABASE_URL
  if (!DATABASE_URL) throw new Error('DATABASE_URL tidak ditemukan di .env')

  const client = sql(DATABASE_URL)
  try {
    const rows = await client`
      SELECT subscriber_id, circuit_id, homepass_id
      FROM ont_current_status
      WHERE last_down_cause = 'los'
        AND last_down_time >= ${fromMs}
        AND last_down_time <= ${toMs}
      ORDER BY last_down_time ASC
    `
    return rows as LosTarget[]
  } finally {
    await client.close()
  }
}

// ─── Live Check ───────────────────────────────────────────────────────────────

/**
 * Perform live check for one target.
 * Returns true if the ONT is still LOS (offline) after the check.
 */
async function liveCheckOne(
  db: TelemetryDatabase,
  auth: ProtelindoAuthManager,
  target: LosTarget,
  index: number,
  total: number,
): Promise<{ stillLos: boolean; circuit_id: string; homepass_id: string }> {
  const prefix = `[${String(index + 1).padStart(String(total).length, ' ')}/${total}]`

  try {
    console.log(
      `${CYAN}${prefix}${RESET} ${DIM}Live checking${RESET} ${BOLD}${target.homepass_id}${RESET}`,
    )

    const detail = await auth.getOntStatus(target.circuit_id, target.homepass_id)

    const existing = await db.getLatestCurrentStatus(target.subscriber_id)
    const subscriptionStatus = existing?.subscription_status || 'AC'

    await db.insertLog(
      target.subscriber_id,
      target.circuit_id,
      target.homepass_id,
      detail.runState || 'unknown',
      JSON.stringify(detail),
      subscriptionStatus,
    )

    const isStillLos =
      detail.runState === 'offline' &&
      detail.lastDownCause?.toLowerCase() === 'los'

    const stateColor = isStillLos ? RED : GREEN
    const stateLabel = isStillLos ? 'MASIH LOS' : `PULIH (${detail.runState || 'unknown'})`

    console.log(
      `${CYAN}${prefix}${RESET} ${stateColor}${BOLD}${stateLabel}${RESET} ${DIM}→${RESET} ${target.homepass_id}`,
    )

    return { stillLos: isStillLos, circuit_id: target.circuit_id, homepass_id: target.homepass_id }
  } catch (err: any) {
    console.error(
      `${CYAN}${prefix}${RESET} ${RED}ERROR${RESET} ${target.homepass_id}: ${err.message || err}`,
    )

    // Write error to DB
    try {
      const existing = await db.getLatestCurrentStatus(target.subscriber_id)
      const subscriptionStatus = existing?.subscription_status || 'AC'
      await db.insertLog(
        target.subscriber_id,
        target.circuit_id,
        target.homepass_id,
        'error',
        JSON.stringify({ error: err.message || 'Live check failed' }),
        subscriptionStatus,
      )
    } catch (_) {}

    // Treat error as "still LOS" — include in export to be safe
    return { stillLos: true, circuit_id: target.circuit_id, homepass_id: target.homepass_id }
  }
}

async function runLiveChecks(
  db: TelemetryDatabase,
  auth: ProtelindoAuthManager,
  targets: LosTarget[],
  concurrency: number,
  delayMs: number,
): Promise<{ circuit_id: string; homepass_id: string }[]> {
  const total = targets.length
  let index = 0
  const stillLosResults: { circuit_id: string; homepass_id: string }[] = []

  async function worker() {
    while (index < total) {
      const currentIndex = index++
      const target = targets[currentIndex]
      const result = await liveCheckOne(db, auth, target, currentIndex, total)
      if (result.stillLos) {
        stillLosResults.push({ circuit_id: result.circuit_id, homepass_id: result.homepass_id })
      }
      if (currentIndex < total - 1 && delayMs > 0) {
        await sleep(delayMs)
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker())
  await Promise.all(workers)

  // Re-sort by original order (circuit_id)
  const orderMap = new Map(targets.map((t, i) => [t.circuit_id + '|' + t.homepass_id, i]))
  stillLosResults.sort(
    (a, b) =>
      (orderMap.get(a.circuit_id + '|' + a.homepass_id) ?? 0) -
      (orderMap.get(b.circuit_id + '|' + b.homepass_id) ?? 0),
  )

  return stillLosResults
}

// ─── Print table ──────────────────────────────────────────────────────────────

function printTable(rows: { circuit_id: string; homepass_id: string }[]) {
  const circuitWidth = Math.max(10, ...rows.map((r) => r.circuit_id.length))
  const homepassWidth = Math.max(11, ...rows.map((r) => r.homepass_id.length))

  console.log(
    `\n${BOLD}${'No'.padEnd(6)} ${'circuit_id'.padEnd(circuitWidth + 2)} ${'homepass_id'.padEnd(homepassWidth)}${RESET}`,
  )
  console.log('─'.repeat(6 + circuitWidth + homepassWidth + 4))

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    console.log(
      `${String(i + 1).padEnd(6)} ${r.circuit_id.padEnd(circuitWidth + 2)} ${r.homepass_id.padEnd(homepassWidth)}`,
    )
  }

  console.log('─'.repeat(6 + circuitWidth + homepassWidth + 4))
  console.log(`${DIM}Total: ${rows.length} baris${RESET}\n`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { fromMs, toMs, outputFile, liveCheck, concurrency, delayMs } = parseArgs()

  const filename = outputFile || generateDefaultFilename()

  console.log(`\n${BOLD}📡 OPTRA LOS Export CLI${RESET}`)
  console.log(`${'─'.repeat(55)}`)
  console.log(`  Dari        : ${YELLOW}${formatTimestamp(fromMs)} WIB${RESET}`)
  console.log(`  Sampai      : ${YELLOW}${formatTimestamp(toMs)} WIB${RESET}`)
  console.log(`  Live Check  : ${liveCheck ? GREEN + 'Ya (concurrency=' + concurrency + ', delay=' + delayMs + 'ms)' + RESET : DIM + 'Tidak (gunakan cache DB)' + RESET}`)
  console.log(`  Output      : ${CYAN}${filename}${RESET}`)
  console.log(`${'─'.repeat(55)}\n`)

  const db = new TelemetryDatabase()
  await db.init()

  // Step 1: Fetch candidates from DB
  console.log(`${BLUE}🔍 Mengambil kandidat LOS dari database...${RESET}`)
  const targets = await fetchLosTargets(fromMs, toMs)

  if (targets.length === 0) {
    console.log(`${YELLOW}⚠️  Tidak ada ONT LOS yang ditemukan dalam periode tersebut.${RESET}\n`)
    await db.close()
    return
  }

  console.log(`${GREEN}✅ Ditemukan ${BOLD}${targets.length}${RESET}${GREEN} kandidat ONT LOS.${RESET}`)

  let exportRows: { circuit_id: string; homepass_id: string }[]

  if (liveCheck) {
    // Step 2: Live check each ONT
    console.log(`\n${YELLOW}⚡ Memulai live check ${targets.length} ONT ke API Protelindo...${RESET}\n`)

    const auth = new ProtelindoAuthManager(db)
    const startTime = Date.now()

    exportRows = await runLiveChecks(db, auth, targets, concurrency, delayMs)

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    const recovered = targets.length - exportRows.length

    console.log(`\n${'─'.repeat(55)}`)
    console.log(`${BOLD}📊 Hasil Live Check${RESET}`)
    console.log(`  Total dicek    : ${targets.length}`)
    console.log(`  ${RED}Masih LOS${RESET}     : ${exportRows.length}`)
    console.log(`  ${GREEN}Sudah pulih${RESET}   : ${recovered}`)
    console.log(`  Durasi         : ${elapsed} detik`)
    console.log(`${'─'.repeat(55)}`)

    if (exportRows.length === 0) {
      console.log(`\n${GREEN}✅ Semua ONT sudah pulih. Tidak ada data untuk dieksport.${RESET}\n`)
      await db.close()
      return
    }
  } else {
    // No live check: export all candidates from DB
    exportRows = targets.map((t) => ({ circuit_id: t.circuit_id, homepass_id: t.homepass_id }))
  }

  // Step 3: Print table
  printTable(exportRows)

  // Step 4: Write CSV
  const csvLines = ['circuit_id,homepass_id']
  for (const r of exportRows) {
    csvLines.push(`${r.circuit_id},${r.homepass_id}`)
  }
  await Bun.write(filename, csvLines.join('\n') + '\n')

  console.log(`${GREEN}💾 File CSV berhasil disimpan: ${BOLD}${filename}${RESET}`)
  console.log(`${DIM}   Total: ${exportRows.length} baris data${RESET}\n`)

  await db.close()
}

main().catch((err) => {
  console.error(`\n${RED}❌ Fatal error: ${err.message || err}${RESET}\n`)
  process.exit(1)
})
