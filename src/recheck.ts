#!/usr/bin/env bun
/**
 * OPTRA Recheck CLI Tool
 *
 * Melakukan live OLT check ulang untuk subscriber yang dipilih berdasarkan filter:
 *   --homepass-prefix  : Prefix homepass_id (wajib)
 *   --before           : Filter updated_at sebelum waktu tertentu (format: YYYY-MM-DD HH:mm:ss, opsional)
 *   --concurrency      : Jumlah worker paralel (default: 3)
 *   --delay            : Jeda antar request dalam ms (default: 1000)
 *   --dry-run          : Hanya tampilkan data tanpa melakukan cek
 *
 * Contoh:
 *   bun run src/recheck.ts --homepass-prefix "LBP1-CAT03" --before "2026-08-02 16:45:00"
 *   bun run src/recheck.ts --homepass-prefix "LBP1-CAT03" --before "2026-08-02 16:45:00" --concurrency 5 --delay 500
 *   bun run src/recheck.ts --homepass-prefix "LBP1-CAT03" --dry-run
 */

import { TelemetryDatabase } from './database'
import { ProtelindoAuthManager } from './protelindo'

// ─── Parse CLI Arguments ──────────────────────────────────────────────────────

function parseArgs(): {
  homepassPrefix: string
  beforeMs: number | null
  concurrency: number
  delayMs: number
  dryRun: boolean
} {
  const args = process.argv.slice(2)
  let homepassPrefix = ''
  let beforeMs: number | null = null
  let concurrency = 3
  let delayMs = 1000
  let dryRun = false

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--homepass-prefix':
        homepassPrefix = args[++i] || ''
        break
      case '--before':
        const raw = args[++i] || ''
        // Interpret as WIB (UTC+7), convert to epoch ms
        const isoStr = raw.replace(' ', 'T') + '+07:00'
        const parsed = Date.parse(isoStr)
        if (isNaN(parsed)) {
          console.error(`❌ Format --before tidak valid: "${raw}". Gunakan: YYYY-MM-DD HH:mm:ss`)
          process.exit(1)
        }
        beforeMs = parsed
        break
      case '--concurrency':
        concurrency = parseInt(args[++i] || '3', 10)
        break
      case '--delay':
        delayMs = parseInt(args[++i] || '1000', 10)
        break
      case '--dry-run':
        dryRun = true
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
    }
  }

  if (!homepassPrefix) {
    console.error('❌ Parameter --homepass-prefix wajib diisi.')
    console.error('   Contoh: bun run src/recheck.ts --homepass-prefix "LBP1-CAT03" --before "2026-08-02 16:45:00"')
    process.exit(1)
  }

  return { homepassPrefix, beforeMs, concurrency, delayMs, dryRun }
}

function printHelp() {
  console.log(`
📡 OPTRA Recheck CLI Tool

PENGGUNAAN:
  bun run src/recheck.ts [opsi]

OPSI WAJIB:
  --homepass-prefix <prefix>   Filter homepass_id yang diawali dengan prefix ini
                                Contoh: --homepass-prefix "LBP1-CAT03"

OPSI OPSIONAL:
  --before <datetime>          Filter updated_at sebelum waktu ini (WIB)
                                Format: YYYY-MM-DD HH:mm:ss
                                Contoh: --before "2026-08-02 16:45:00"
  --concurrency <n>            Jumlah worker paralel (default: 3)
  --delay <ms>                 Jeda antar request dalam milidetik (default: 1000)
  --dry-run                    Tampilkan data yang akan dicek, tanpa hit API
  --help, -h                   Tampilkan bantuan ini

CONTOH:
  bun run src/recheck.ts --homepass-prefix "LBP1-CAT03" --before "2026-08-02 16:45:00"
  bun run src/recheck.ts --homepass-prefix "LBP1-CAT03" --concurrency 5 --delay 500
  bun run src/recheck.ts --homepass-prefix "LBP1-CAT03" --before "2026-08-02 16:45:00" --dry-run
`)
}

// ─── Fetch target subscribers from DB ────────────────────────────────────────

async function fetchTargets(
  db: TelemetryDatabase,
  homepassPrefix: string,
  beforeMs: number | null,
): Promise<{ subscriber_id: number; circuit_id: string; homepass_id: string; run_state: string; updated_at: number }[]> {
  return db.fetchRecheckTargets(homepassPrefix, beforeMs)
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

// ─── Worker: Perform single recheck ──────────────────────────────────────────

async function recheckOne(
  db: TelemetryDatabase,
  auth: ProtelindoAuthManager,
  target: { subscriber_id: number; circuit_id: string; homepass_id: string },
  index: number,
  total: number,
): Promise<{ success: boolean; run_state?: string; rx_optical_power?: number | null; error?: string }> {
  const prefix = `[${String(index + 1).padStart(String(total).length, ' ')}/${total}]`

  try {
    console.log(
      `${CYAN}${prefix}${RESET} ${DIM}Checking${RESET} ${BOLD}${target.homepass_id}${RESET} ${DIM}(subscriber: ${target.subscriber_id})${RESET}`,
    )

    // 1. Fetch live status
    const detail = await auth.getOntStatus(target.circuit_id, target.homepass_id)

    // 2. Get existing subscription_status
    const existing = await db.getLatestCurrentStatus(target.subscriber_id)
    const subscriptionStatus = existing?.subscription_status || 'AC'

    // 3. Write to DB (log + update current status)
    await db.insertLog(
      target.subscriber_id,
      target.circuit_id,
      target.homepass_id,
      detail.runState || 'unknown',
      JSON.stringify(detail),
      subscriptionStatus,
    )

    const rxStr = detail.rxOpticalPower ? `${parseFloat(detail.rxOpticalPower).toFixed(2)} dBm` : 'N/A'
    const stateColor = detail.runState === 'online' ? GREEN : detail.runState === 'offline' ? RED : YELLOW
    console.log(
      `${CYAN}${prefix}${RESET} ${stateColor}${BOLD}${(detail.runState || 'unknown').toUpperCase()}${RESET} | Rx: ${MAGENTA}${rxStr}${RESET} | Cause: ${DIM}${detail.lastDownCause || '-'}${RESET} → ${BOLD}${target.homepass_id}${RESET}`,
    )

    return {
      success: true,
      run_state: detail.runState || 'unknown',
      rx_optical_power: detail.rxOpticalPower ? parseFloat(detail.rxOpticalPower) : null,
    }
  } catch (err: any) {
    console.error(
      `${CYAN}${prefix}${RESET} ${RED}ERROR${RESET} ${target.homepass_id}: ${err.message || err}`,
    )

    // Write error state to DB
    try {
      const existing = await db.getLatestCurrentStatus(target.subscriber_id)
      const subscriptionStatus = existing?.subscription_status || 'AC'
      await db.insertLog(
        target.subscriber_id,
        target.circuit_id,
        target.homepass_id,
        'error',
        JSON.stringify({ error: err.message || 'Recheck failed' }),
        subscriptionStatus,
      )
    } catch (_) {}

    return { success: false, error: err.message || String(err) }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { homepassPrefix, beforeMs, concurrency, delayMs, dryRun } = parseArgs()

  console.log(`\n${BOLD}📡 OPTRA Recheck CLI${RESET}`)
  console.log(`${'─'.repeat(50)}`)
  console.log(`  Prefix     : ${CYAN}${homepassPrefix}${RESET}`)
  console.log(`  Before     : ${beforeMs ? YELLOW + formatTimestamp(beforeMs) + ' WIB' + RESET : DIM + '(tidak difilter)' + RESET}`)
  console.log(`  Concurrency: ${concurrency} worker`)
  console.log(`  Delay      : ${delayMs} ms`)
  console.log(`  Mode       : ${dryRun ? YELLOW + 'DRY RUN (tidak hit API)' + RESET : GREEN + 'LIVE' + RESET}`)
  console.log(`${'─'.repeat(50)}\n`)

  // Init DB
  const db = new TelemetryDatabase()
  await db.init()

  // Fetch targets
  console.log(`${BLUE}🔍 Mengambil data dari database...${RESET}`)
  const targets = await fetchTargets(db, homepassPrefix, beforeMs)

  if (targets.length === 0) {
    console.log(`${YELLOW}⚠️  Tidak ada data yang cocok dengan filter yang diberikan.${RESET}`)
    await db.close()
    return
  }

  console.log(`${GREEN}✅ Ditemukan ${BOLD}${targets.length}${RESET}${GREEN} subscriber yang akan dicek ulang.${RESET}\n`)

  // Print table
  console.log(
    `${BOLD}${'No'.padEnd(5)} ${'Homepass ID'.padEnd(25)} ${'Circuit ID'.padEnd(20)} ${'State'.padEnd(10)} ${'Updated At (WIB)'.padEnd(22)}${RESET}`,
  )
  console.log('─'.repeat(85))
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    const stateColor = t.run_state === 'online' ? GREEN : t.run_state === 'offline' ? RED : YELLOW
    console.log(
      `${String(i + 1).padEnd(5)} ${t.homepass_id.padEnd(25)} ${t.circuit_id.padEnd(20)} ${stateColor}${t.run_state.padEnd(10)}${RESET} ${DIM}${formatTimestamp(Number(t.updated_at))}${RESET}`,
    )
  }
  console.log('─'.repeat(85))

  if (dryRun) {
    console.log(`\n${YELLOW}🔎 Dry run selesai. Tidak ada request yang dikirim ke API.${RESET}\n`)
    await db.close()
    return
  }

  // Confirm before proceeding
  console.log(`\n${YELLOW}⚡ Mulai recheck ${targets.length} subscriber...${RESET}\n`)

  // Init auth
  const auth = new ProtelindoAuthManager(db)

  // Stats counters
  let successCount = 0
  let errorCount = 0
  const startTime = Date.now()

  // Process with concurrency using a queue approach
  let index = 0
  const total = targets.length

  async function worker() {
    while (index < total) {
      const currentIndex = index++
      const target = targets[currentIndex]

      const result = await recheckOne(db, auth, target, currentIndex, total)
      if (result.success) {
        successCount++
      } else {
        errorCount++
      }

      // Delay between requests (except last)
      if (currentIndex < total - 1 && delayMs > 0) {
        await sleep(delayMs)
      }
    }
  }

  // Launch N concurrent workers
  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker())
  await Promise.all(workers)

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`${BOLD}📊 Recheck Selesai${RESET}`)
  console.log(`  Total     : ${total}`)
  console.log(`  ${GREEN}Sukses${RESET}    : ${successCount}`)
  console.log(`  ${RED}Error${RESET}     : ${errorCount}`)
  console.log(`  Durasi    : ${elapsed} detik`)
  console.log(`${'─'.repeat(50)}\n`)

  await db.close()
}

main().catch((err) => {
  console.error(`\n${RED}❌ Fatal error: ${err.message || err}${RESET}\n`)
  process.exit(1)
})
