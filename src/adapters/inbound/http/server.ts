import Fastify, { type FastifyInstance } from 'fastify'
import { z } from 'zod'
import { LocationSchema, UserProfileSchema } from '../../../domain/feed/types'
import type { UserRepositoryPort } from '../../../domain/feed/user-repository-port'
import type { MatchPort } from '../../../domain/match/match-port'
import { UserIdSchema } from '../../../domain/shared/types'
import { SwipeDecisionSchema } from '../../../domain/swipe-match/types'
import type { GetFeedUseCase } from '../../../use-cases/get-feed'
import type { RecordSwipeUseCase } from '../../../use-cases/record-swipe'

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

export type HttpDeps = {
  getFeed: GetFeedUseCase
  recordSwipe: RecordSwipeUseCase
  userRepo: UserRepositoryPort
  matchPort: MatchPort
}

export function createServer(deps: HttpDeps): FastifyInstance {
  const app = Fastify({ logger: true })

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: 'invalid_input', issues: err.issues })
    }
    app.log.error(err)
    return reply.code(500).send({ error: 'internal_error' })
  })

  app.get('/health', async () => ({ status: 'ok' }))

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
