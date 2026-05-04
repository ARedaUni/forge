import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AuthError, type AuthPort } from '../../../core/auth/port'
import { UserIdSchema, type UserId } from '../../../core/shared/types'

const userId = (): UserId => UserIdSchema.parse(randomUUID())

export type AuthContractSetup = {
  name: string
  setup: () => AuthPort
}

export function runAuthContract(cfg: AuthContractSetup): void {
  describe(`AuthPort contract — ${cfg.name}`, () => {
    it('issueCredential returns a non-empty string', async () => {
      const adapter = cfg.setup()
      const credential = await adapter.issueCredential(userId())
      expect(typeof credential).toBe('string')
      expect(credential.length).toBeGreaterThan(0)
    })

    it('verifyCredential round-trips the userId', async () => {
      const adapter = cfg.setup()
      const id = userId()
      const credential = await adapter.issueCredential(id)
      const recovered = await adapter.verifyCredential(credential)
      expect(recovered).toBe(id)
    })

    it('verifyCredential throws AuthError for a tampered credential', async () => {
      const adapter = cfg.setup()
      await expect(adapter.verifyCredential('not.a.valid.credential')).rejects.toThrow(
        AuthError,
      )
    })

    it('verifyCredential throws AuthError for a credential signed with a different secret', async () => {
      const adapter = cfg.setup()
      const other = cfg.setup()
      const credential = await adapter.issueCredential(userId())
      await expect(other.verifyCredential(credential)).rejects.toThrow(AuthError)
    })
  })
}
