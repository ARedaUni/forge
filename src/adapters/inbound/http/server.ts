import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { z } from 'zod'
import { AuthError, type AuthPort } from '../../../domain/auth/port'
import type { MatchPort } from '../../../domain/match/port'
import type { HealthCheck } from '../../../domain/observability/healthCheck'
import type { Logger } from '../../../domain/observability/logger'
import { enterLoggerContext } from '../../../infrastructure/observability/requestContext'
import { UserIdSchema, type UserId } from '../../../domain/shared/types'
import { SwipeDecisionSchema } from '../../../domain/swipe-match/types'
import type { UserRepositoryPort } from '../../../domain/user/port'
import { LocationSchema, UserProfileSchema } from '../../../domain/user/types'
import type { GetFeedUseCase } from '../../../use-cases/getFeed'
import type { RecordSwipeUseCase } from '../../../use-cases/recordSwipe'

declare module 'fastify' {
  interface FastifyRequest {
    principal?: { userId: UserId }
    logger?: Logger
  }
}

const FeedRequestSchema = z.object({
  center: LocationSchema,
  radiusKm: z.number().positive(),
  limit: z.number().int().positive().max(500),
})

const SwipeRequestSchema = z.object({
  targetId: UserIdSchema,
  decision: SwipeDecisionSchema,
})

const ListMatchesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  before: z.coerce.date().optional(),
})

const IssueTokenRequestSchema = z.object({
  userId: UserIdSchema,
})

export type HttpDeps = {
  getFeed: GetFeedUseCase
  recordSwipe: RecordSwipeUseCase
  userRepo: UserRepositoryPort
  matchPort: MatchPort
  authPort: AuthPort
  logger: Logger
  healthChecks?: HealthCheck[]
}

const PUBLIC_ROUTES = new Set(['/livez', '/readyz', '/auth/token'])

async function authMiddleware(
  authPort: AuthPort,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (PUBLIC_ROUTES.has(req.routeOptions.url ?? '')) return

  const header = req.headers['authorization']
  if (!header?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'unauthorized' })
  }

  const token = header.slice(7)
  try {
    const userId = await authPort.verifyToken(token)
    req.principal = { userId }
  } catch (err) {
    if (err instanceof AuthError) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    throw err
  }
}

function requirePrincipal(req: FastifyRequest): { userId: UserId } {
  if (!req.principal) {
    throw new AuthError('missing principal')
  }
  return req.principal
}

export function createServer(deps: HttpDeps): FastifyInstance {
  const app = Fastify({ logger: false })

  app.addHook('onRequest', async (req) => {
    const reqId = randomUUID()
    const child = deps.logger.child({ reqId, method: req.method, url: req.url })
    req.logger = child
    enterLoggerContext(child)
    child.info('request received')
  })

  app.addHook('onRequest', async (req, reply) => {
    await authMiddleware(deps.authPort, req, reply)
  })

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: 'invalid_input', issues: err.issues })
    }
    if (err instanceof AuthError) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    ;(req.logger ?? deps.logger).error('unhandled error', { err: String(err) })
    return reply.code(500).send({ error: 'internal_error' })
  })

  app.get('/livez', async () => ({ status: 'ok' }))

  app.get('/readyz', async (_req, reply) => {
    const checks = deps.healthChecks ?? []
    const results = await Promise.all(
      checks.map(async (hc) => {
        try {
          await hc.check()
          return { name: hc.name, ok: true, critical: hc.critical }
        } catch {
          return { name: hc.name, ok: false, critical: hc.critical }
        }
      }),
    )
    const criticalDown = results.some((r) => !r.ok && r.critical)
    const status = criticalDown ? 'down' : 'ok'
    const code = criticalDown ? 503 : 200
    return reply.code(code).send({ status, checks: results })
  })

  app.post('/auth/token', async (req) => {
    const { userId } = IssueTokenRequestSchema.parse(req.body)
    const token = await deps.authPort.issueToken(userId)
    return { token }
  })

  app.post('/profiles', async (req, reply) => {
    const { userId } = requirePrincipal(req)
    const profile = UserProfileSchema.parse(req.body)
    if (profile.id !== userId) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    await deps.userRepo.upsert(profile)
    return reply.code(201).send({ id: profile.id })
  })

  app.post('/feed', async (req, reply) => {
    const { userId } = requirePrincipal(req)
    const input = FeedRequestSchema.parse(req.body)
    const viewer = await deps.userRepo.findById(userId)
    if (!viewer) {
      return reply.code(404).send({ error: 'profile_not_found' })
    }
    const candidates = await deps.getFeed.execute({ ...input, viewer })
    return { candidates }
  })

  app.post('/swipes', async (req) => {
    const { userId } = requirePrincipal(req)
    const { targetId, decision } = SwipeRequestSchema.parse(req.body)
    const result = await deps.recordSwipe.execute({
      swiperId: userId,
      targetId,
      decision,
      createdAt: new Date(),
    })
    return result
  })

  app.get('/matches', async (req) => {
    const { userId } = requirePrincipal(req)
    const { limit, before } = ListMatchesQuerySchema.parse(req.query)
    const options: { limit?: number; before?: Date } = {}
    if (limit !== undefined) options.limit = limit
    if (before !== undefined) options.before = before
    const matches = await deps.matchPort.listForUser(userId, options)
    return { matches }
  })

  return app
}
