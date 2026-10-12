import { getSecret } from '../secretsManager.ts'

export function validateEnvironment() {
  const required = ['BETTER_AUTH_SECRET', 'CSRF_SECRET', 'COOKIE_SECRET']

  if (getSecret('NODE_ENV') === 'production') {
    required.push('RESEND_API_KEY')
  }

  const missing = required.filter(key => !getSecret(key))

  if (missing.length > 0) {
    console.warn(
      `WARNING: Missing environment variables: ${missing.join(', ')}`
    )
  }
}
