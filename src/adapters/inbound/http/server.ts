import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { z } from 'zod'
import { AuthError, type AuthPort } from '../../../domain/auth/port'
import { LocationSchema, UserProfileSchema } from '../../../domain/feed/types'
import type { MatchPort } from '../../../domain/match/port'
import { UserIdSchema } from '../../../domain/shared/types'
import { SwipeDecisionSchema } from '../../../domain/swipe-match/types'
import type { UserRepositoryPort } from '../../../domain/user-repository/port'
import type { GetFeedUseCase } from '../../../use-cases/getFeed'
import type { RecordSwipeUseCase } from '../../../use-cases/recordSwipe'

const FeedRequestSchema = z.object({
  viewer: UserProfileSchema,
  center: LocationSchema,
  radiusKm: z.number().positive(),
  limit: z.number().int().positive().max(500),
})

const SwipeRequestSchema = z.object({
  swiperId: UserIdSchema,
  targetId: UserIdSchema,
  decision: SwipeDecisionSchema,
})

const ListMatchesQuerySchema = z.object({
  userId: UserIdSchema,
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
}

const PUBLIC_ROUTES = new Set(['/health', '/auth/token'])

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
    await authPort.verifyToken(token)
  } catch (err) {
    if (err instanceof AuthError) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    throw err
  }
}

export function createServer(deps: HttpDeps): FastifyInstance {
  const app = Fastify({ logger: true })

  app.addHook('onRequest', async (req, reply) => {
    await authMiddleware(deps.authPort, req, reply)
  })

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: 'invalid_input', issues: err.issues })
    }
    app.log.error(err)
    return reply.code(500).send({ error: 'internal_error' })
  })

  app.get('/health', async () => ({ status: 'ok' }))

  app.post('/auth/token', async (req) => {
    const { userId } = IssueTokenRequestSchema.parse(req.body)
    const token = await deps.authPort.issueToken(userId)
    return { token }
  })

  app.post('/profiles', async (req, reply) => {
    const profile = UserProfileSchema.parse(req.body)
    await deps.userRepo.upsert(profile)
    return reply.code(201).send({ id: profile.id })
  })

  app.post('/feed', async (req) => {
    const input = FeedRequestSchema.parse(req.body)
    const candidates = await deps.getFeed.execute(input)
    return { candidates }
  })

  app.post('/swipes', async (req) => {
    const parsed = SwipeRequestSchema.parse(req.body)
    const result = await deps.recordSwipe.execute({
      ...parsed,
      createdAt: new Date(),
    })
    return result
  })

  app.get('/matches', async (req) => {
    const { userId, limit, before } = ListMatchesQuerySchema.parse(req.query)
    const options: { limit?: number; before?: Date } = {}
    if (limit !== undefined) options.limit = limit
    if (before !== undefined) options.before = before
    const matches = await deps.matchPort.listForUser(userId, options)
    return { matches }
  })

  return app
}
