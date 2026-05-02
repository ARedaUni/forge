import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AuthError, type AuthPort } from '../../../domain/auth/port'
import { UserIdSchema, type UserId } from '../../../domain/shared/types'

const userId = (): UserId => UserIdSchema.parse(randomUUID())

export type AuthContractSetup = {
  name: string
  setup: () => AuthPort
}

export function runAuthContract(cfg: AuthContractSetup): void {
  describe(`AuthPort contract — ${cfg.name}`, () => {
    it('issueToken returns a non-empty string', async () => {
      const adapter = cfg.setup()
      const token = await adapter.issueToken(userId())
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(0)
    })

    it('verifyToken round-trips the userId', async () => {
      const adapter = cfg.setup()
      const id = userId()
      const token = await adapter.issueToken(id)
      const recovered = await adapter.verifyToken(token)
      expect(recovered).toBe(id)
    })

    it('verifyToken throws AuthError for a tampered token', async () => {
      const adapter = cfg.setup()
      await expect(adapter.verifyToken('not.a.valid.token')).rejects.toThrow(AuthError)
    })

    it('verifyToken throws AuthError for a token signed with a different secret', async () => {
      const adapter = cfg.setup()
      const other = cfg.setup()
      const token = await adapter.issueToken(userId())
      await expect(other.verifyToken(token)).rejects.toThrow(AuthError)
    })
  })
}
