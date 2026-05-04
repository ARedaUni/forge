import { Counter, Histogram, Registry } from 'prom-client'
import type { SwipeDecision } from '../../core/swipe-match/types'

export type SwipeOutcomeResult = 'recorded' | 'matched'

export type Metrics = {
  registry: Registry
  recordHttpRequest(args: {
    method: string
    route: string
    status: number
    durationSec: number
  }): void
  recordSwipeOutcome(args: { decision: SwipeDecision; result: SwipeOutcomeResult }): void
}

const HTTP_DURATION_BUCKETS_SEC = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]

export function createMetrics(): Metrics {
  const registry = new Registry()

  const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Count of HTTP requests served, labelled by method, route template, and response status.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
  })

  const httpRequestDurationSeconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request handler latency in seconds.',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: HTTP_DURATION_BUCKETS_SEC,
    registers: [registry],
  })

  const swipeOutcomesTotal = new Counter({
    name: 'swipe_outcomes_total',
    help: 'Count of swipes processed by RecordSwipeUseCase, labelled by decision and outcome.',
    labelNames: ['decision', 'result'] as const,
    registers: [registry],
  })

  return {
    registry,
    recordHttpRequest({ method, route, status, durationSec }) {
      const labels = { method, route, status: String(status) }
      httpRequestsTotal.inc(labels)
      httpRequestDurationSeconds.observe(labels, durationSec)
    },
    recordSwipeOutcome({ decision, result }) {
      swipeOutcomesTotal.inc({ decision, result })
    },
  }
}
