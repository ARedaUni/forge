import { runAuthContract } from './contract'
import { JwtAuthAdapter } from './jwt'

runAuthContract({
  name: 'jwt',
  setup: () => new JwtAuthAdapter({ secret: 'test-secret-' + Math.random() }),
})
