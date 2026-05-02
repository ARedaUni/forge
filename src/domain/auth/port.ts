import type { UserId } from '../shared/types'

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export interface AuthPort {
  issueToken(userId: UserId): Promise<string>
  verifyToken(token: string): Promise<UserId>
}
