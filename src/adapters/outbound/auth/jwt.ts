import jwt, { type SignOptions } from 'jsonwebtoken'
import { AuthError, type AuthPort } from '../../../domain/auth/port'
import { UserIdSchema, type UserId } from '../../../domain/shared/types'

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

  async issueToken(userId: UserId): Promise<string> {
    const options: SignOptions =
      this.expiresIn !== undefined ? { expiresIn: this.expiresIn } : {}
    return jwt.sign({ sub: userId }, this.secret, options)
  }

  async verifyToken(token: string): Promise<UserId> {
    try {
      const payload = jwt.verify(token, this.secret) as JwtPayload
      return UserIdSchema.parse(payload.sub)
    } catch {
      throw new AuthError('invalid or expired token')
    }
  }
}
