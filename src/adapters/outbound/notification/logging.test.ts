import type { LogFields, Logger } from '../../../core/observability/logger'
import { runDeliveryContract } from './contract'
import { LoggingNotificationDeliveryAdapter } from './logging'

const captureLogger = (sink: Array<{ message: string; fields: LogFields | undefined }>): Logger => ({
  debug: () => undefined,
  info: (message, fields) => {
    sink.push({ message, fields })
  },
  warn: () => undefined,
  error: () => undefined,
  child: function (this: Logger) {
    return this
  },
})

runDeliveryContract({
  name: 'LoggingNotificationDeliveryAdapter',
  build: () => {
    const logged: Array<{ message: string; fields: LogFields | undefined }> = []
    const adapter = new LoggingNotificationDeliveryAdapter(captureLogger(logged))
    return { adapter, observed: () => logged.map((l) => l.fields ?? {}) }
  },
})
