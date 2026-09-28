export interface AgentInfo {
  did?: string
  version: string
}

export interface Liveness {
  status: 'live'
}

export interface Readiness {
  status: 'ready'
}
