export type HealthCheck = {
  name: string
  critical: boolean
  check: () => Promise<void>
}
