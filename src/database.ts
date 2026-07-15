import { SQL } from 'bun'

export class TelemetryDatabase {
  private sql: SQL
  private staleHours: number

  constructor() {
    const dbUrl = Bun.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres'
    this.sql = new SQL(dbUrl)
    this.staleHours = parseInt(Bun.env.STALE_ENTRY_THRESHOLD_HOURS || '48', 10)
  }

  private get staleCutoffMs(): number {
    return Date.now() - this.staleHours * 3600 * 1000
  }

  /**
   * Initializes the database schema, creating tables and indexes if they don't exist
   */
  public async init(): Promise<void> {
    // 1. Time-series log table (stores all checks historically)
    await this.sql`
      CREATE TABLE IF NOT EXISTS ont_telemetry_logs (
        id SERIAL PRIMARY KEY,
        subscriber_id INTEGER NOT NULL,
        circuit_id VARCHAR(255) NOT NULL,
        homepass_id VARCHAR(255) NOT NULL,
        run_state VARCHAR(50) NOT NULL,
        last_down_cause VARCHAR(100),
        last_down_time BIGINT,
        raw_response TEXT NOT NULL,
        checked_at BIGINT NOT NULL
      )
    `

    // Create historical index
    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_homepass_check 
      ON ont_telemetry_logs (homepass_id, checked_at DESC)
    `

    // 2. Current live status table (stores only 1 row per subscriber)
    await this.sql`
      CREATE TABLE IF NOT EXISTS ont_current_status (
        subscriber_id INTEGER PRIMARY KEY,
        circuit_id VARCHAR(255) NOT NULL,
        homepass_id VARCHAR(255) NOT NULL,
        run_state VARCHAR(50) NOT NULL,
        rx_optical_power DOUBLE PRECISION,  -- Numeric signal value
        last_down_cause VARCHAR(100),       -- Latest down cause (e.g. dying-gasp)
        last_down_time BIGINT,              -- Latest down timestamp (Unix ms)
        raw_response TEXT NOT NULL,         -- Latest full JSON response
        updated_at BIGINT NOT NULL,
        subscription_status VARCHAR(20) DEFAULT 'AC'
      )
    `

    // Migration for existing table
    await this.sql`
      ALTER TABLE ont_current_status
      ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'AC'
    `

    // Create indexes for performance
    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_current_signal
      ON ont_current_status (run_state, rx_optical_power)
      WHERE run_state = 'online' AND rx_optical_power IS NOT NULL
    `

    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_current_down_cause
      ON ont_current_status (run_state, last_down_cause)
      WHERE run_state = 'offline' AND last_down_cause IS NOT NULL
    `

    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_current_downtime
      ON ont_current_status (run_state, last_down_time)
      WHERE run_state = 'offline' AND last_down_time IS NOT NULL
    `

    // 3. Centralized Auth Session Table (ensures single active session shared between Hono & Daemon)
    await this.sql`
      CREATE TABLE IF NOT EXISTS ont_auth_session (
        id INT PRIMARY KEY,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        expires_in INTEGER NOT NULL,
        created_at BIGINT NOT NULL
      )
    `
  }

  /**
   * Inserts a new ONT telemetry log entry and updates the current live status table
   */
  public async insertLog(
    subscriberId: number,
    circuitId: string,
    homepassId: string,
    runState: string,
    rawResponse: string,
    subscriptionStatus: string = 'AC',
  ): Promise<void> {
    const now = Date.now()

    // Parse values safely from JSON response
    let rxOpticalPower: number | null = null
    let lastDownCause: string | null = null
    let lastDownTimeMs: number | null = null

    try {
      const parsed = JSON.parse(rawResponse)

      // Extract rx_optical_power if online
      if (runState === 'online' && parsed.rxOpticalPower) {
        const val = parseFloat(parsed.rxOpticalPower)
        if (!isNaN(val)) {
          rxOpticalPower = val
        }
      }

      // Extract lastDownCause if present
      if (parsed.lastDownCause) {
        lastDownCause = parsed.lastDownCause
      }

      // Extract and parse lastDownTime into a Unix timestamp (millisecond)
      if (
        parsed.lastDownTime &&
        parsed.lastDownTime !== '--' &&
        parsed.lastDownTime.trim() !== ''
      ) {
        const formattedDate = parsed.lastDownTime.replace(' ', 'T')
        const parsedMs = Date.parse(formattedDate)
        if (!isNaN(parsedMs)) {
          lastDownTimeMs = parsedMs
        }
      }
    } catch (_) {}

    // 1. Insert into historical time-series logs
    await this.sql`
      INSERT INTO ont_telemetry_logs (
        subscriber_id, 
        circuit_id, 
        homepass_id, 
        run_state, 
        last_down_cause,
        last_down_time,
        raw_response, 
        checked_at
      ) VALUES (
        ${subscriberId}, 
        ${circuitId}, 
        ${homepassId}, 
        ${runState}, 
        ${lastDownCause},
        ${lastDownTimeMs},
        ${rawResponse}, 
        ${now}
      )
    `

    // 2. Upsert (Insert or Conflict Update) into current live status table
    //    Skip when runState is 'error' to preserve last known good state
    if (runState !== 'error') {
      await this.sql`
        INSERT INTO ont_current_status (
          subscriber_id,
          circuit_id,
          homepass_id,
          run_state,
          rx_optical_power,
          last_down_cause,
          last_down_time,
          raw_response,
          updated_at,
          subscription_status
        ) VALUES (
          ${subscriberId},
          ${circuitId},
          ${homepassId},
          ${runState},
          ${rxOpticalPower},
          ${lastDownCause},
          ${lastDownTimeMs},
          ${rawResponse},
          ${now},
          ${subscriptionStatus}
        )
        ON CONFLICT (subscriber_id) DO UPDATE SET
          circuit_id = EXCLUDED.circuit_id,
          homepass_id = EXCLUDED.homepass_id,
          run_state = EXCLUDED.run_state,
          rx_optical_power = EXCLUDED.rx_optical_power,
          last_down_cause = EXCLUDED.last_down_cause,
          last_down_time = EXCLUDED.last_down_time,
          raw_response = EXCLUDED.raw_response,
          updated_at = EXCLUDED.updated_at,
          subscription_status = EXCLUDED.subscription_status
      `
    }
  }

  /**
   * Checks if a subscriber was recently offline due to dying-gasp within the skip window
   */
  public async shouldSkipDyingGasp(subscriberId: number, skipHours: number): Promise<boolean> {
    const skipLimitMs = skipHours * 60 * 60 * 1000

    const results = await this.sql`
      SELECT updated_at FROM ont_current_status
      WHERE subscriber_id = ${subscriberId} 
        AND run_state = 'offline' 
        AND last_down_cause = 'dying-gasp'
    `

    if (results.length > 0) {
      const result = results[0] as any
      const elapsed = Date.now() - Number(result.updated_at)
      return elapsed < skipLimitMs
    }

    return false
  }

  /**
   * Checks if a subscriber was recently online with an excellent signal (> threshold) within the skip window
   */
  public async shouldSkipGoodSignal(
    subscriberId: number,
    skipHours: number,
    threshold: number,
  ): Promise<boolean> {
    const skipLimitMs = skipHours * 60 * 60 * 1000

    const results = await this.sql`
      SELECT updated_at, rx_optical_power FROM ont_current_status
      WHERE subscriber_id = ${subscriberId} 
        AND run_state = 'online' 
        AND rx_optical_power IS NOT NULL
    `

    if (results.length > 0) {
      const result = results[0] as any
      if (result.rx_optical_power !== null && result.rx_optical_power > threshold) {
        const elapsed = Date.now() - Number(result.updated_at)
        return elapsed < skipLimitMs
      }
    }

    return false
  }

  /**
   * Checks if a subscriber should be skipped based on progressive exponential backoff for offline state
   */
  public async shouldSkipOfflineBackoff(
    subscriberId: number,
    config: {
      range1To6HoursSkipMin: number
      range6To24HoursSkipMin: number
      rangeAbove24HoursSkipMin: number
    },
  ): Promise<{ shouldSkip: boolean; reason?: string }> {
    const results = await this.sql`
      SELECT updated_at, last_down_time, run_state FROM ont_current_status
      WHERE subscriber_id = ${subscriberId}
    `

    if (results.length === 0) return { shouldSkip: false }

    const result = results[0] as any
    const { run_state, updated_at, last_down_time } = result

    if (run_state !== 'offline') {
      return { shouldSkip: false }
    }

    const now = Date.now()
    // Convert BigInt safely
    const effectiveDownTime = Number(last_down_time || updated_at)
    const elapsedDowntimeMs = now - effectiveDownTime
    const elapsedLastCheckMs = now - Number(updated_at)

    const hourMs = 60 * 60 * 1000

    let skipLimitMs = 0
    let rangeName = ''

    if (elapsedDowntimeMs < 1 * hourMs) {
      return { shouldSkip: false }
    } else if (elapsedDowntimeMs < 6 * hourMs) {
      skipLimitMs = config.range1To6HoursSkipMin * 60 * 1000
      rangeName = '1-6h offline'
    } else if (elapsedDowntimeMs < 24 * hourMs) {
      skipLimitMs = config.range6To24HoursSkipMin * 60 * 1000
      rangeName = '6-24h offline'
    } else {
      skipLimitMs = config.rangeAbove24HoursSkipMin * 60 * 1000
      rangeName = '>24h offline'
    }

    const shouldSkip = elapsedLastCheckMs < skipLimitMs
    if (shouldSkip) {
      const minutesRemaining = Math.ceil((skipLimitMs - elapsedLastCheckMs) / (60 * 1000))
      return {
        shouldSkip: true,
        reason: `${rangeName}, checked ${Math.floor(elapsedLastCheckMs / (60 * 1000))}m ago, cooldown next ${minutesRemaining}m`,
      }
    }

    return { shouldSkip: false }
  }

  /**
   * Retrieves the current live status record of a specific subscriber
   */
  public async getLatestCurrentStatus(subscriberId: number): Promise<any> {
    const results = await this.sql`
      SELECT * FROM ont_current_status
      WHERE subscriber_id = ${subscriberId}
    `
    return results.length > 0 ? results[0] : null
  }

  /**
   * Retrieves the online ONTs with optical signal strength below the specified threshold
   */
  public async getWeakSignals(thresholdDbm: number = -24, limit: number = 100): Promise<any[]> {
    return await this.sql`
      SELECT * FROM ont_current_status
      WHERE run_state = 'online' AND rx_optical_power IS NOT NULL AND rx_optical_power <= ${thresholdDbm}
        AND updated_at > ${this.staleCutoffMs}
      ORDER BY rx_optical_power ASC
      LIMIT ${limit}
    `
  }

  /**
   * Retrieves the offline ONTs whose last down cause was a power loss (dying-gasp)
   */
  public async getDyingGaspOutages(limit: number = 1000): Promise<any[]> {
    return await this.sql`
      SELECT * FROM ont_current_status
      WHERE run_state = 'offline' AND last_down_cause = 'dying-gasp'
        AND updated_at > ${this.staleCutoffMs}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `
  }

  /**
   * Retrieves the offline ONTs whose last down cause was a fiber cut (LOS), sorted by oldest downtime first
   */
  public async getLosOutages(limit: number = 1000): Promise<any[]> {
    return await this.sql`
      SELECT * FROM ont_current_status
      WHERE run_state = 'offline' AND last_down_cause = 'LOS' AND last_down_time IS NOT NULL
        AND updated_at > ${this.staleCutoffMs}
      ORDER BY last_down_time ASC
      LIMIT ${limit}
    `
  }

  /**
   * Retrieves the offline ONTs whose last down cause was unspecified (e.g. '--' or empty)
   */
  public async getUnspecifiedOutages(limit: number = 1000): Promise<any[]> {
    return await this.sql`
      SELECT * FROM ont_current_status
      WHERE run_state = 'offline' AND (last_down_cause = '--' OR last_down_cause IS NULL OR last_down_cause = '')
        AND updated_at > ${this.staleCutoffMs}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `
  }

  /**
   * Retrieves the ONTs with unknown status or failed telemetry checks
   */
  public async getUnknownOutages(limit: number = 1000): Promise<any[]> {
    return await this.sql`
      SELECT * FROM ont_current_status
      WHERE (run_state = 'unknown' OR run_state = 'error')
        AND updated_at > ${this.staleCutoffMs}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `
  }

  /**
   * Retrieves the offline ONTs that have been down for more than the specified threshold (longest offline first)
   */
  public async getChronicOutages(thresholdDays: number = 40, limit: number = 1000): Promise<any[]> {
    const cutoff = Date.now() - thresholdDays * 24 * 60 * 60 * 1000
    return await this.sql`
      SELECT * FROM ont_current_status
      WHERE run_state = 'offline' AND last_down_time IS NOT NULL AND last_down_time < ${cutoff}
        AND updated_at > ${this.staleCutoffMs}
      ORDER BY last_down_time ASC
      LIMIT ${limit}
    `
  }

  /**
   * Retrieves historical log entries for a specific homepass or circuit ID
   */
  public async getHistory(homepassId: string, limit: number = 20): Promise<any[]> {
    return await this.sql`
      SELECT l.*, c.subscription_status
      FROM ont_telemetry_logs l
      LEFT JOIN ont_current_status c ON l.subscriber_id = c.subscriber_id
      WHERE l.homepass_id = ${homepassId} OR l.circuit_id = ${homepassId}
      ORDER BY l.checked_at DESC
      LIMIT ${limit}
    `
  }

  /**
   * Retrieves all subscribers with optional status filters and text search
   */
  public async getAllSubscribers(
    search?: string,
    status?: string,
    limit: number = 100,
    offset: number = 0,
  ): Promise<any[]> {
    const searchPattern = search ? `%${search}%` : '%'

    if (status && status !== 'all') {
      return await this.sql`
        SELECT * FROM ont_current_status
        WHERE run_state = ${status}
          AND (circuit_id LIKE ${searchPattern} OR homepass_id LIKE ${searchPattern} OR raw_response LIKE ${searchPattern})
          AND updated_at > ${this.staleCutoffMs}
        ORDER BY updated_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `
    } else {
      return await this.sql`
        SELECT * FROM ont_current_status
        WHERE (circuit_id LIKE ${searchPattern} OR homepass_id LIKE ${searchPattern} OR raw_response LIKE ${searchPattern})
          AND updated_at > ${this.staleCutoffMs}
        ORDER BY updated_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `
    }
  }

  /**
   * Retrieves network aggregation stats
   */
  public async getStats(): Promise<any> {
    const cutoff = this.staleCutoffMs
    const [totalRes, onlineRes, offlineRes, errorRes, dyingGaspRes, unspecifiedRes, unknownRes] =
      await Promise.all([
        this.sql`SELECT COUNT(*) FROM ont_current_status WHERE updated_at > ${cutoff}`,
        this
          .sql`SELECT COUNT(*) FROM ont_current_status WHERE run_state = 'online' AND updated_at > ${cutoff}`,
        this
          .sql`SELECT COUNT(*) FROM ont_current_status WHERE run_state = 'offline' AND updated_at > ${cutoff}`,
        this
          .sql`SELECT COUNT(*) FROM ont_current_status WHERE run_state = 'error' AND updated_at > ${cutoff}`,
        this
          .sql`SELECT COUNT(*) FROM ont_current_status WHERE run_state = 'offline' AND last_down_cause = 'dying-gasp' AND updated_at > ${cutoff}`,
        this
          .sql`SELECT COUNT(*) FROM ont_current_status WHERE run_state = 'offline' AND (last_down_cause = '--' OR last_down_cause IS NULL OR last_down_cause = '') AND updated_at > ${cutoff}`,
        this
          .sql`SELECT COUNT(*) FROM ont_current_status WHERE (run_state = 'unknown' OR run_state = 'error') AND updated_at > ${cutoff}`,
      ])

    const total = Number(totalRes[0].count)
    const online = Number(onlineRes[0].count)
    const offline = Number(offlineRes[0].count)
    const error = Number(errorRes[0].count)
    const dyingGasp = Number(dyingGaspRes[0].count)
    const unspecified = Number(unspecifiedRes[0].count)
    const unknown = Number(unknownRes[0].count)

    return {
      total,
      online,
      offline,
      error,
      dyingGasp,
      unspecified,
      unknown,
    }
  }

  /**
   * Retrieves the active auth session from the database
   */
  public async getSession(): Promise<any> {
    const results = await this.sql`
      SELECT * FROM ont_auth_session WHERE id = 1
    `
    return results.length > 0 ? results[0] : null
  }

  /**
   * Saves or updates the active auth session in the database
   */
  public async saveSession(
    accessToken: string,
    refreshToken: string | null,
    expiresIn: number,
    createdAt: number,
  ): Promise<void> {
    await this.sql`
      INSERT INTO ont_auth_session (id, access_token, refresh_token, expires_in, created_at)
      VALUES (1, ${accessToken}, ${refreshToken}, ${expiresIn}, ${createdAt})
      ON CONFLICT (id) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        expires_in = EXCLUDED.expires_in,
        created_at = EXCLUDED.created_at
    `
  }

  /**
   * Close the database connection
   */
  public async close(): Promise<void> {
    await this.sql.close()
  }
}
