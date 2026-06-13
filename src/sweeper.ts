import { ProtelindoAuthManager } from './protelindo'
import { NisGatewayClient } from './nis'
import { TelemetryDatabase } from './database'
import type { Homepass } from './types'

// Helper function to colorize text in the terminal
export const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
}

/**
 * Executes a single sweep cycle of FTTx subscribers using a concurrent worker pool
 */
export async function runSweepCycle(cycleCount: number): Promise<any> {
  const dyingGaspSkipHours = parseInt(Bun.env.DYING_GASP_SKIP_HOURS || '8', 10)
  const goodSignalSkipHours = parseInt(Bun.env.GOOD_SIGNAL_SKIP_HOURS || '6', 10)
  const goodSignalThreshold = parseFloat(Bun.env.GOOD_SIGNAL_THRESHOLD || '-20')
  const maxPages = parseInt(Bun.env.MONITOR_MAX_PAGES || '0', 10)
  const offline1To6Min = parseInt(Bun.env.OFFLINE_BACKOFF_1_TO_6_HOURS_SKIP_MINUTES || '60', 10)
  const offline6To24Min = parseInt(Bun.env.OFFLINE_BACKOFF_6_TO_24_HOURS_SKIP_MINUTES || '240', 10)
  const offlineAbove24Min = parseInt(
    Bun.env.OFFLINE_BACKOFF_ABOVE_24_HOURS_SKIP_MINUTES || '720',
    10,
  )

  const cycleStartTime = Date.now()

  console.log('==========================================================================')
  console.log(
    `${colors.cyan}${colors.bold}🔄 MONITOR CHECK CYCLE #${cycleCount} STARTED${colors.reset}`,
  )
  console.log(`Started at: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`)
  console.log('==========================================================================\n')

  let db: TelemetryDatabase | null = null
  let totalOnline = 0
  let totalOffline = 0
  let totalError = 0

  try {
    db = new TelemetryDatabase()
    await db.init() // Initialize PostgreSQL tables/indexes asynchronously

    const authManager = new ProtelindoAuthManager(db)
    const nisClient = new NisGatewayClient()

    // 1. Authenticate Protelindo
    await authManager.getValidAccessToken()
    console.log(`${colors.green}✓ Protelindo session verified.${colors.reset}\n`)

    // 2. Fetch all valid homepasses into a single task queue
    let page = 1
    const pageSize = 100
    let totalHomepasses = 0
    let hasMore = true
    const taskQueue: any[] = []

    console.log('🔌 Pulling active subscriber homepasses from NIS Gateway...')

    while (hasMore) {
      if (maxPages > 0 && page > maxPages) {
        console.log(
          `${colors.yellow}⚠️ Max page limit of ${maxPages} reached. Stopping batch fetch.${colors.reset}`,
        )
        break
      }

      const response = await nisClient.getHomepasses(page, pageSize)
      totalHomepasses = response.total

      const batchResults = response.results
      if (batchResults.length === 0) {
        break
      }

      const validHomepasses = batchResults.filter(
        (hp) => hp.homepass_id && hp.homepass_id.trim() !== '',
      )
      taskQueue.push(...validHomepasses)

      page++
      const fetchedSoFar = (page - 1) * pageSize
      if (fetchedSoFar >= totalHomepasses) {
        hasMore = false
      }
    }

    const actualTotal = taskQueue.length
    console.log(
      `🔌 Pulled ${colors.bold}${actualTotal}${colors.reset} valid subscriber homepasses.\n`,
    )

    // 3. Process the queue using a concurrent worker pool
    const concurrency = parseInt(Bun.env.MONITOR_CONCURRENCY || '5', 10)
    const delayMs = parseInt(Bun.env.ONT_QUERY_DELAY_MS || '1000', 10)
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    console.log(
      `🔌 Starting Worker Pool with ${colors.bold}${concurrency} workers${colors.reset} and a delay of ${colors.bold}${delayMs}ms${colors.reset} per task...\n`,
    )

    let processedHomepasses = 0

    async function startWorker(workerId: number) {
      while (taskQueue.length > 0) {
        const hp = taskQueue.shift()
        if (!hp) break

        processedHomepasses++
        const currentNum = processedHomepasses

        // [OPTIMIZATION 1]: Check if subscriber should be skipped due to a recent dying-gasp power outage
        if (await db!.shouldSkipDyingGasp(hp.subscriber_id, dyingGaspSkipHours)) {
          console.log(
            `🔌 [W#${workerId}][${currentNum}/${actualTotal}] ${colors.yellow}Skipping ${hp.subscriber_name} (Recent dying-gasp offline check < ${dyingGaspSkipHours} hours ago).${colors.reset}`,
          )

          totalOffline++
          continue
        }

        // [OPTIMIZATION 2]: Check if subscriber should be skipped due to a recent excellent signal check
        if (
          await db!.shouldSkipGoodSignal(hp.subscriber_id, goodSignalSkipHours, goodSignalThreshold)
        ) {
          console.log(
            `🔌 [W#${workerId}][${currentNum}/${actualTotal}] ${colors.green}Skipping ${hp.subscriber_name} (Excellent signal > ${goodSignalThreshold} dBm checked < ${goodSignalSkipHours} hours ago).${colors.reset}`,
          )

          totalOnline++
          continue
        }

        // [OPTIMIZATION 3]: Check if subscriber should be skipped due to progressive offline backoff
        const backoffCheck = await db!.shouldSkipOfflineBackoff(hp.subscriber_id, {
          range1To6HoursSkipMin: offline1To6Min,
          range6To24HoursSkipMin: offline6To24Min,
          rangeAbove24HoursSkipMin: offlineAbove24Min,
        })

        if (backoffCheck.shouldSkip) {
          console.log(
            `🔌 [W#${workerId}][${currentNum}/${actualTotal}] ${colors.yellow}Skipping ${hp.subscriber_name} (Offline backoff: ${backoffCheck.reason}).${colors.reset}`,
          )

          totalOffline++
          continue
        }

        console.log(
          `🔌 [W#${workerId}][${currentNum}/${actualTotal}] Fetching ONT status for ${colors.bold}${hp.subscriber_name}${colors.reset} (${hp.homepass_id})...`,
        )

        try {
          const detail = await authManager.getOntStatus(hp.circuit_id, hp.homepass_id)

          await db!.insertLog(
            hp.subscriber_id,
            hp.circuit_id,
            hp.homepass_id,
            detail.runState || 'unknown',
            JSON.stringify(detail),
          )

          if (detail.runState === 'online') totalOnline++
          else totalOffline++
        } catch (err: any) {
          const errorMessage = err.message || 'Failed to fetch status'

          await db!.insertLog(
            hp.subscriber_id,
            hp.circuit_id,
            hp.homepass_id,
            'error',
            JSON.stringify({ error: errorMessage }),
          )

          totalError++
        }

        // Apply delay between status fetches per worker
        if (taskQueue.length > 0) {
          await delay(delayMs)
        }
      }
    }

    const workers = []
    for (let w = 1; w <= concurrency; w++) {
      workers.push(startWorker(w))
    }
    await Promise.all(workers)

    // 4. Present the dashboard in console
    console.log(`\n==========================================================================`)
    console.log(
      `${colors.cyan}${colors.bold}📈 ACTIVE ONT STATUS SUMMARY (CYCLE #${cycleCount})${colors.reset}`,
    )
    console.log('==========================================================================\n')

    const totalChecked = totalOnline + totalOffline + totalError

    console.log(`📊 Total Subscribers Processed: ${colors.bold}${totalChecked}${colors.reset}`)
    console.log(`- ${colors.green}ONLINE  : ${totalOnline}${colors.reset}`)
    console.log(`- ${colors.red}OFFLINE : ${totalOffline}${colors.reset}`)
    if (totalError > 0) {
      console.log(`- ${colors.red}ERRORS  : ${totalError}${colors.reset}`)
    }

    const durationSec = Math.ceil((Date.now() - cycleStartTime) / 1000)
    console.log(
      `\n${colors.green}🎉 Successfully completed Sweep Cycle #${cycleCount} in ${durationSec} seconds!${colors.reset}\n`,
    )

    return {
      success: true,
      cycleCount,
      totalChecked,
      totalOnline,
      totalOffline,
      totalError,
      durationSec,
    }
  } catch (error) {
    console.error(
      `\n${colors.red}💥 Critical Error in Sweep Cycle #${cycleCount}:${colors.reset}`,
      error,
    )
    return { success: false, error: (error as any).message || String(error) }
  } finally {
    if (db) {
      await db.close()
      console.log('🔒 PostgreSQL Database connection closed.')
    }
  }
}

/**
 * Standalone entrypoint for daemon monitoring
 */
async function main() {
  const loopIntervalMs = parseInt(Bun.env.MONITOR_LOOP_INTERVAL_MS || '300000', 10)
  const dyingGaspSkipHours = parseInt(Bun.env.DYING_GASP_SKIP_HOURS || '8', 10)
  const goodSignalSkipHours = parseInt(Bun.env.GOOD_SIGNAL_SKIP_HOURS || '6', 10)
  const goodSignalThreshold = parseFloat(Bun.env.GOOD_SIGNAL_THRESHOLD || '-20')
  const maxPages = parseInt(Bun.env.MONITOR_MAX_PAGES || '0', 10)
  const offline1To6Min = parseInt(Bun.env.OFFLINE_BACKOFF_1_TO_6_HOURS_SKIP_MINUTES || '60', 10)
  const offline6To24Min = parseInt(Bun.env.OFFLINE_BACKOFF_6_TO_24_HOURS_SKIP_MINUTES || '240', 10)
  const offlineAbove24Min = parseInt(
    Bun.env.OFFLINE_BACKOFF_ABOVE_24_HOURS_SKIP_MINUTES || '720',
    10,
  )
  const concurrency = parseInt(Bun.env.MONITOR_CONCURRENCY || '5', 10)

  let cycleCount = 0

  console.log('==========================================================================')
  console.log(
    `${colors.cyan}${colors.bold}📡 OPTRA - PROTELINDO ONT MONITOR DAEMON (POSTGRESQL)${colors.reset}`,
  )
  console.log(
    `- Sweep Cooldown : ${colors.bold}${loopIntervalMs / 1000} seconds${colors.reset} between sweeps.`,
  )
  console.log(
    `- Concurrency    : ${colors.bold}${concurrency} workers${colors.reset} running in parallel.`,
  )
  console.log(
    `- Dying-Gasp Skip: ${colors.bold}${dyingGaspSkipHours} hours${colors.reset} cooldown for power outages.`,
  )
  console.log(
    `- Good-Signal Skip: ${colors.bold}${goodSignalSkipHours} hours${colors.reset} cooldown for signal > ${goodSignalThreshold} dBm.`,
  )
  console.log(
    `- Offline Backoff: ${colors.bold}${offline1To6Min}m / ${offline6To24Min}m / ${offlineAbove24Min}m${colors.reset} progressive intervals.`,
  )
  if (maxPages > 0) {
    console.log(
      `- Max Pages Limit: ${colors.bold}${maxPages} page(s)${colors.reset} (restricted run for testing).`,
    )
  }
  console.log('==========================================================================\n')

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  while (true) {
    cycleCount++
    await runSweepCycle(cycleCount)

    console.log(
      `\n😴 Sleeping for ${colors.bold}${loopIntervalMs / 1000} seconds${colors.reset} before next check cycle...\n`,
    )
    await delay(loopIntervalMs)
  }
}

if (import.meta.main) {
  main()
}
