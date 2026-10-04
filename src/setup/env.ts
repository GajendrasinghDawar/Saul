export function validateEnvironment() {
  const required = ['BETTER_AUTH_SECRET', 'CSRF_SECRET', 'COOKIE_SECRET']

  if (process.env.NODE_ENV === 'production') {
    required.push('RESEND_API_KEY')
  }

  const missing = required.filter(key => !process.env[key])

  if (missing.length > 0) {
    throw new Error(
      `FATAL: Missing required environment variables: ${missing.join(', ')}`
    )
  }
}
