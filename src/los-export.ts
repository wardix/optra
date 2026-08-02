#!/usr/bin/env bun
/**
 * OPTRA LOS Export CLI Tool
 *
 * Mengekspor circuit_id dan homepass_id untuk ONT yang saat ini offline
 * akibat LOS (Loss of Signal) dengan last_down_time dalam periode tertentu.
 *
 * Sumber data: ont_current_status
 * Filter     : run_state = 'offline', last_down_cause = 'los', last_down_time dalam rentang --from s.d --to
 *
 * Contoh:
 *   bun run src/los-export.ts --from "2026-08-01 00:00:00" --to "2026-08-02 23:59:59"
 *   bun run src/los-export.ts --from "2026-08-01 00:00:00" --to "2026-08-02 23:59:59" --output los_report.csv
 */

// ─── Parse CLI Arguments ──────────────────────────────────────────────────────

function parseArgs(): {
  fromMs: number
  toMs: number
  outputFile: string | null
} {
  const args = process.argv.slice(2)
  let fromMs: number | null = null
  let toMs: number | null = null
  let outputFile: string | null = null

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
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
    }
  }

  if (fromMs === null || toMs === null) {
    console.error('❌ Parameter --from dan --to wajib diisi.')
    console.error('   Contoh: bun run src/los-export.ts --from "2026-08-01 00:00:00" --to "2026-08-02 23:59:59"')
    process.exit(1)
  }

  if (fromMs > toMs) {
    console.error('❌ Nilai --from tidak boleh lebih besar dari --to.')
    process.exit(1)
  }

  return { fromMs, toMs, outputFile }
}

function printHelp() {
  console.log(`
📡 OPTRA LOS Export CLI Tool

PENGGUNAAN:
  bun run src/los-export.ts [opsi]

OPSI WAJIB:
  --from <datetime>   Awal periode last_down_time (WIB). Format: YYYY-MM-DD HH:mm:ss
  --to   <datetime>   Akhir periode last_down_time (WIB). Format: YYYY-MM-DD HH:mm:ss

OPSI OPSIONAL:
  --output <file>     Nama file CSV output (default: los_export_<timestamp>.csv)
  --help, -h          Tampilkan bantuan ini

CONTOH:
  bun run src/los-export.ts --from "2026-08-01 00:00:00" --to "2026-08-02 23:59:59"
  bun run src/los-export.ts --from "2026-08-01 00:00:00" --to "2026-08-02 23:59:59" --output hasil_los.csv
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

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const BLUE = '\x1b[34m'

// ─── Query ────────────────────────────────────────────────────────────────────

async function fetchLosOutages(
  fromMs: number,
  toMs: number,
): Promise<{ circuit_id: string; homepass_id: string }[]> {
  const { sql } = await import('bun')

  const DATABASE_URL = Bun.env.DATABASE_URL
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL tidak ditemukan di .env')
  }

  const client = sql(DATABASE_URL)

  try {
    const rows = await client`
      SELECT circuit_id, homepass_id
      FROM ont_current_status
      WHERE run_state = 'offline'
        AND last_down_cause = 'los'
        AND last_down_time >= ${fromMs}
        AND last_down_time <= ${toMs}
      ORDER BY last_down_time ASC
    `
    return rows as { circuit_id: string; homepass_id: string }[]
  } finally {
    await client.end()
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { fromMs, toMs, outputFile } = parseArgs()

  const filename = outputFile || generateDefaultFilename()

  console.log(`\n${BOLD}📡 OPTRA LOS Export CLI${RESET}`)
  console.log(`${'─'.repeat(50)}`)
  console.log(`  Dari   : ${YELLOW}${formatTimestamp(fromMs)} WIB${RESET}`)
  console.log(`  Sampai : ${YELLOW}${formatTimestamp(toMs)} WIB${RESET}`)
  console.log(`  Output : ${CYAN}${filename}${RESET}`)
  console.log(`${'─'.repeat(50)}\n`)

  console.log(`${BLUE}🔍 Mengambil data LOS dari database...${RESET}`)

  const rows = await fetchLosOutages(fromMs, toMs)

  if (rows.length === 0) {
    console.log(`${YELLOW}⚠️  Tidak ada ONT LOS yang ditemukan dalam periode tersebut.${RESET}\n`)
    return
  }

  console.log(`${GREEN}✅ Ditemukan ${BOLD}${rows.length}${RESET}${GREEN} ONT LOS.${RESET}\n`)

  // Print table to terminal
  const circuitWidth = Math.max(10, ...rows.map((r) => r.circuit_id.length))
  const homepassWidth = Math.max(11, ...rows.map((r) => r.homepass_id.length))

  console.log(
    `${BOLD}${'No'.padEnd(6)} ${'circuit_id'.padEnd(circuitWidth + 2)} ${'homepass_id'.padEnd(homepassWidth)}${RESET}`,
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

  // Write CSV
  const csvLines = ['circuit_id,homepass_id']
  for (const r of rows) {
    csvLines.push(`${r.circuit_id},${r.homepass_id}`)
  }
  const csvContent = csvLines.join('\n') + '\n'

  await Bun.write(filename, csvContent)

  console.log(`${GREEN}💾 File CSV berhasil disimpan: ${BOLD}${filename}${RESET}`)
  console.log(`${DIM}   Total: ${rows.length} baris data${RESET}\n`)
}

main().catch((err) => {
  console.error(`\n${RED}❌ Fatal error: ${err.message || err}${RESET}\n`)
  process.exit(1)
})
