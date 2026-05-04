import type { UserId } from '../shared/types'

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export interface AuthPort {
  issueCredential(userId: UserId): Promise<string>
  verifyCredential(credential: string): Promise<UserId>
}
