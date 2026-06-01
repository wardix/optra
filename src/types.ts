export interface TokenResponse {
  access_token: string
  token_type: string
  refresh_token: string
  expires_in: number
  scope: string
  jti: string
  created_at?: number // timestamp in ms when token was fetched
}

export interface Homepass {
  subscriber_id: number
  subscriber_name: string
  circuit_id: string
  homepass_id: string
}

export interface HomepassesResponse {
  results: Homepass[]
  total: number
}

export interface OntStatusResponse {
  fsp: string | null
  ontId: string | null
  serialNo: string | null
  controlFlag: string | null
  runState: string | null // e.g. "online", "offline"
  description: string | null
  lastDownCause: string | null
  lastUpTime: string | null
  lastDownTime: string | null
  rxOpticalPower: string | null
  txOprticalPower: string | null // NOTE: The API has a typo: "txOprticalPower" instead of "txOpticalPower"
  name: string | null
  ipv4ConnectionStatus: string | null
  ipv4Address: string | null
  subnetMask: string | null
  defaultGateway: string | null
  primaryDNS: string | null
  secondaryDNS: string | null
  listState: string | null
  temperature: string | null
  macAddress: string | null
  ssid: string | null
  ssidPass: string | null
}
