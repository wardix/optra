import type { HomepassesResponse } from './types'

export class NisGatewayClient {
  private apiUrl: string
  private token: string
  private defaultOperatorId: string

  constructor() {
    this.apiUrl = Bun.env.NIS_HOMEPASS_API_URL || ''
    this.token = Bun.env.NIS_GATEWAY_TOKEN || ''
    this.defaultOperatorId = Bun.env.PROTELINDO_OPERATOR_ID || '22'

    if (!this.apiUrl || !this.token) {
      console.warn('⚠️ Warning: NIS Homepass API URL or Token is missing in your .env file!')
    }
  }

  /**
   * Fetches the homepasses list with pagination and operator filtering
   */
  public async getHomepasses(
    page: number = 1,
    pageSize: number = 10,
    operatorId: string = this.defaultOperatorId,
  ): Promise<HomepassesResponse> {
    console.log(
      `🌐 Fetching homepasses (Page: ${page}, Page Size: ${pageSize}, Operator: ${operatorId})...`,
    )

    if (!this.apiUrl) {
      throw new Error('NIS_HOMEPASS_API_URL is not configured.')
    }

    const url = new URL(this.apiUrl)
    url.searchParams.set('page', page.toString())
    url.searchParams.set('page_size', pageSize.toString())
    url.searchParams.set('operator_id', operatorId)

    const headers = new Headers()
    headers.set('accept', 'application/json')
    headers.set('Authorization', `Bearer ${this.token}`)

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to fetch homepasses: Status ${response.status} - ${errorText}`)
    }

    const data = (await response.json()) as HomepassesResponse
    return data
  }
}
