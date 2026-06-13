import type { TokenResponse, OntStatusResponse } from './types'
import { TelemetryDatabase } from './database'

export class ProtelindoAuthManager {
  private authUrl: string
  private statusUrl: string
  private username: string
  private password: string
  private partnerSource: string
  private timeoutMs: number

  private db: TelemetryDatabase

  constructor(db: TelemetryDatabase) {
    this.db = db
    this.authUrl = Bun.env.PROTELINDO_AUTH_API_URL || ''
    this.statusUrl = Bun.env.PROTELINDO_ONT_STATUS_API_URL || ''
    this.username = Bun.env.PROTELINDO_API_USERNAME || ''
    this.password = Bun.env.PROTELINDO_API_PASSWORD || ''
    this.partnerSource = Bun.env.PARTNER_SOURCE || 'NUSANET'
    this.timeoutMs = parseInt(Bun.env.API_TIMEOUT_MS || '30000', 10)

    if (!this.authUrl || !this.username || !this.password) {
      console.warn('⚠️ Warning: Protelindo Authentication variables are missing in your .env file!')
    }
  }

  /**
   * Encodes the username and password to a Basic Auth base64 string
   */
  private getBasicAuthHeader(): string {
    const credentials = `${this.username}:${this.password}`
    return `Basic ${Buffer.from(credentials).toString('base64')}`
  }

  /**
   * Saves the token response to PostgreSQL database
   */
  private async saveSession(tokenData: TokenResponse): Promise<void> {
    try {
      const createdAt = tokenData.created_at || Date.now()
      await this.db.saveSession(
        tokenData.access_token,
        tokenData.refresh_token || null,
        tokenData.expires_in,
        createdAt,
      )
      console.log('💾 Protelindo session successfully saved to PostgreSQL database!')
    } catch (error) {
      console.error('❌ Failed to save session to PostgreSQL database:', error)
    }
  }

  /**
   * Loads the existing token from PostgreSQL database
   */
  public async loadSession(): Promise<TokenResponse | null> {
    try {
      const session = await this.db.getSession()
      if (!session) return null

      return {
        access_token: session.access_token,
        token_type: 'Bearer',
        refresh_token: session.refresh_token || '',
        expires_in: session.expires_in,
        scope: '',
        jti: '',
        created_at: Number(session.created_at),
      }
    } catch (error) {
      console.error('❌ Failed to load session from PostgreSQL database:', error)
      return null
    }
  }

  /**
   * Checks if the access token is expired or close to expiring (within 5 minutes buffer)
   */
  public isTokenExpired(tokenData: TokenResponse): boolean {
    if (!tokenData.created_at) return true

    const bufferTimeMs = 5 * 60 * 1000 // 5 minutes safety buffer
    const expiryTimeMs = tokenData.created_at + tokenData.expires_in * 1000

    return Date.now() >= expiryTimeMs - bufferTimeMs
  }

  /**
   * Performs authentication to get a new token using username/password
   */
  public async login(): Promise<TokenResponse> {
    console.log('🔑 Authenticating with Protelindo API (Full Login)...')

    if (!this.authUrl) {
      throw new Error('PROTELINDO_AUTH_API_URL is not configured.')
    }

    const headers = new Headers()
    headers.set('Content-Type', 'application/x-www-form-urlencoded')
    headers.set('Authorization', this.getBasicAuthHeader())

    const body = new URLSearchParams()
    body.set('username', this.username)
    body.set('password', this.password)
    body.set('grant_type', 'password')

    const response = await fetch(this.authUrl, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Authentication failed: Status ${response.status} - ${errorText}`)
    }

    const tokenData = (await response.json()) as TokenResponse
    tokenData.created_at = Date.now()
    await this.saveSession(tokenData)

    return tokenData
  }

  /**
   * Performs a token refresh request using a refresh token
   */
  public async refresh(refreshToken: string): Promise<TokenResponse> {
    console.log('🔄 Refreshing Protelindo access token using refresh token...')

    if (!this.authUrl) {
      throw new Error('PROTELINDO_AUTH_API_URL is not configured.')
    }

    const headers = new Headers()
    headers.set('Content-Type', 'application/x-www-form-urlencoded')
    headers.set('Authorization', this.getBasicAuthHeader())

    const body = new URLSearchParams()
    body.set('grant_type', 'refresh_token')
    body.set('refresh_token', refreshToken)

    const response = await fetch(this.authUrl, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Token refresh failed: Status ${response.status} - ${errorText}`)
    }

    const tokenData = (await response.json()) as TokenResponse
    tokenData.created_at = Date.now()
    await this.saveSession(tokenData)

    return tokenData
  }

  /**
   * Retrieves a valid access token, auto-refreshing via refresh token or logging in if expired
   */
  public async getValidAccessToken(): Promise<string> {
    const existingSession = await this.loadSession()

    if (existingSession) {
      if (!this.isTokenExpired(existingSession)) {
        return existingSession.access_token
      }

      // Token is expired. Let's try to use the refresh token if available
      if (existingSession.refresh_token) {
        try {
          const refreshedSession = await this.refresh(existingSession.refresh_token)
          return refreshedSession.access_token
        } catch (refreshErr) {
          console.warn(
            '⚠️ Refresh token attempt failed, falling back to full credentials login:',
            refreshErr,
          )
        }
      } else {
        console.log(
          '⏰ Protelindo access token expired. No refresh token found. Re-authenticating...',
        )
      }
    } else {
      console.log('📭 No active Protelindo session found in PostgreSQL database.')
    }

    // Full credentials login fallback
    const newSession = await this.login()
    return newSession.access_token
  }

  /**
   * Fetches the ONT status detail for a given homepass
   */
  public async getOntStatus(circuitId: string, homepassId: string): Promise<OntStatusResponse> {
    if (!this.statusUrl) {
      throw new Error('PROTELINDO_ONT_STATUS_API_URL is not configured.')
    }

    const token = await this.getValidAccessToken()

    const headers = new Headers()
    headers.set('X-CUSTOMER-ID-PARTNER', circuitId)
    headers.set('X-PARTNER-SOURCE', this.partnerSource)
    headers.set('X-HOMEPASS-ID', homepassId)
    headers.set('Authorization', `Bearer ${token}`)

    const response = await fetch(this.statusUrl, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to fetch ONT status: Status ${response.status} - ${errorText}`)
    }

    const data = (await response.json()) as OntStatusResponse
    return data
  }
}
