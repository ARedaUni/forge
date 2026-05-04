import jwt, { type SignOptions } from 'jsonwebtoken'
import { AuthError, type AuthPort } from '../../../core/auth/port'
import { UserIdSchema, type UserId } from '../../../core/shared/types'

type JwtConfig = {
  secret: string
  expiresIn?: SignOptions['expiresIn']
}

type JwtPayload = {
  sub: string
}

export class JwtAuthAdapter implements AuthPort {
  private readonly secret: string
  private readonly expiresIn: SignOptions['expiresIn']

  constructor(config: JwtConfig) {
    this.secret = config.secret
    this.expiresIn = config.expiresIn ?? '7d'
  }

  async issueCredential(userId: UserId): Promise<string> {
    const options: SignOptions =
      this.expiresIn !== undefined ? { expiresIn: this.expiresIn } : {}
    return jwt.sign({ sub: userId }, this.secret, options)
  }

  async verifyCredential(credential: string): Promise<UserId> {
    try {
      const payload = jwt.verify(credential, this.secret) as JwtPayload
      return UserIdSchema.parse(payload.sub)
    } catch {
      throw new AuthError('invalid or expired credential')
    }
  }
}
