import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { TelemetryDatabase } from './database'
import { ProtelindoAuthManager } from './protelindo'

const app = new Hono()

// Create and initialize a single persistent database pool for the server lifetime
const db = new TelemetryDatabase()
await db.init()

// Configurable chronic outage threshold (days)
const CHRONIC_OUTAGE_THRESHOLD_DAYS = parseInt(Bun.env.CHRONIC_OUTAGE_THRESHOLD_DAYS || '40', 10)

// Configurable weak signal threshold (dBm)
const WEAK_SIGNAL_THRESHOLD_DBM = parseFloat(Bun.env.WEAK_SIGNAL_THRESHOLD_DBM || '-24')

// Configurable stale entry threshold (hours)
const STALE_ENTRY_THRESHOLD_HOURS = parseInt(Bun.env.STALE_ENTRY_THRESHOLD_HOURS || '48', 10)

// CORS Helper for development
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*')
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  c.header('Access-Control-Allow-Headers', 'Content-Type')
  if (c.req.method === 'OPTIONS') {
    return c.text('OK', 200)
  }
  await next()
})

/**
 * GET /api/config
 * Exposes runtime configuration to the frontend (e.g. chronic outage threshold)
 */
app.get('/api/config', (c) => {
  return c.json({
    chronicOutageThresholdDays: CHRONIC_OUTAGE_THRESHOLD_DAYS,
    weakSignalThresholdDbm: WEAK_SIGNAL_THRESHOLD_DBM,
    staleEntryThresholdHours: STALE_ENTRY_THRESHOLD_HOURS,
  })
})

/**
 * GET /api/stats
 * Retrieves network summaries and percentages
 */
app.get('/api/stats', async (c) => {
  try {
    const stats = await db.getStats()
    return c.json(stats)
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch stats' }, 500)
  }
})

/**
 * GET /api/weak-signals
 * Retrieves the top 10 worst optical power strengths
 */
app.get('/api/weak-signals', async (c) => {
  const limit = parseInt(c.req.query('limit') || '100', 10)
  try {
    const list = await db.getWeakSignals(WEAK_SIGNAL_THRESHOLD_DBM, limit)
    return c.json(list)
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch weak signals' }, 500)
  }
})

/**
 * GET /api/outages
 * Retrieves active offline outages
 */
app.get('/api/outages', async (c) => {
  const type = c.req.query('type') // e.g. "dying-gasp" or "longest"
  const limit = parseInt(c.req.query('limit') || '1000', 10)

  try {
    let list
    if (type === 'dying-gasp') {
      list = await db.getDyingGaspOutages(limit)
    } else if (type === 'los') {
      list = await db.getLosOutages(limit)
    } else if (type === 'unspecified') {
      list = await db.getUnspecifiedOutages(limit)
    } else if (type === 'unknown') {
      list = await db.getUnknownOutages(limit)
    } else {
      list = await db.getChronicOutages(CHRONIC_OUTAGE_THRESHOLD_DAYS, limit)
    }
    return c.json(list)
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch outages' }, 500)
  }
})

/**
 * GET /api/history/:homepassId
 * Historical checks for a subscriber
 */
app.get('/api/history/:homepassId', async (c) => {
  const homepassId = c.req.param('homepassId')
  const limit = parseInt(c.req.query('limit') || '20', 10)

  try {
    const list = await db.getHistory(homepassId, limit)
    return c.json(list)
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch history' }, 500)
  }
})

/**
 * POST /api/check
 * Triggers a real-time live OLT status check for a single subscriber
 */
app.post('/api/check', async (c) => {
  try {
    const { subscriber_id, circuit_id, homepass_id } = await c.req.json()

    if (!subscriber_id || !circuit_id || !homepass_id) {
      return c.json(
        { error: 'Missing required fields: subscriber_id, circuit_id, homepass_id' },
        400,
      )
    }

    const subscriberId = parseInt(subscriber_id, 10)
    if (isNaN(subscriberId)) {
      return c.json({ error: 'Invalid subscriber_id' }, 400)
    }

    const auth = new ProtelindoAuthManager(db)

    try {
      console.log(
        `⚡ Live OLT query triggered directly from frontend for ${circuit_id} (${homepass_id})`,
      )

      // 1. Fetch live status from Protelindo API
      const detail = await auth.getOntStatus(circuit_id, homepass_id)

      // 2. Write into database
      await db.insertLog(
        subscriberId,
        circuit_id,
        homepass_id,
        detail.runState || 'unknown',
        JSON.stringify(detail),
        'AC',
      )

      return c.json({
        success: true,
        subscriber_id: subscriberId,
        circuit_id,
        homepass_id,
        run_state: detail.runState || 'unknown',
        rx_optical_power: detail.rxOpticalPower ? parseFloat(detail.rxOpticalPower) : null,
        last_down_cause: detail.lastDownCause || null,
        raw_response: JSON.stringify(detail),
      })
    } catch (err: any) {
      console.error(`❌ Manual check failed for subscriber ${subscriberId}:`, err)
      // Write error status to database
      try {
        await db.insertLog(
          subscriberId,
          circuit_id,
          homepass_id,
          'error',
          JSON.stringify({ error: err.message || 'Manual check OLT request failed' }),
          'AC',
        )
      } catch (_) {}
      return c.json({ error: err.message || 'Failed to query OLT status' }, 500)
    }
  } catch (parseErr: any) {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
})

// Serve frontend assets in production
app.use('/*', serveStatic({ root: './frontend/dist' }))

const port = parseInt(Bun.env.PORT || '3000', 10)
console.log(`📡 Full-stack Hono Portal listening on port ${port}...`)

const shutdown = async () => {
  console.log('🔌 Shutting down Hono server gracefully...')
  await db.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

export default {
  port,
  fetch: app.fetch,
}
