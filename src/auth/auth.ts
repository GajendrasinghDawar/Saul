import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { bearer, deviceAuthorization } from 'better-auth/plugins'
import { Resend } from 'resend'
import { db } from '../db/index.ts'
import { getSecret } from '../secretsManager.ts'

const resendApiKey = getSecret('RESEND_API_KEY')
const resend = resendApiKey ? new Resend(resendApiKey) : null
const fromEmail = 'onboarding@resend.dev'

export const auth = betterAuth({
  plugins: [
    bearer(),
    deviceAuthorization({
      verificationUri: '/device',
    }),
  ],
  secret: getSecret('BETTER_AUTH_SECRET', ''),
  database: drizzleAdapter(db, {
    provider: 'sqlite',
  }),
  baseURL: getSecret('BETTER_AUTH_URL', 'http://localhost:3000'),
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: false,
        defaultValue: 'user',
      },
    },
  },
  trustedOrigins: [
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5175',
  ],
  rateLimit: {
    enabled: true,
    storage: 'database',
    customRules: {
      '/api/auth/sign-in/email': { window: 60, max: 5 },
      '/api/auth/sign-up/email': { window: 60, max: 3 },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 24 hours
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 256,
    resetPasswordTokenExpiresIn: 60 * 30, // 30 minutes
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      if (!resend) {
        console.log(`[Auth] Password reset link for ${user.email}: ${url}`)
        return
      }
      await resend.emails.send({
        from: fromEmail,
        to: user.email,
        subject: 'Reset your Lali password',
        html: `
          <h2>Reset your password</h2>
          <p>Hi ${user.name},</p>
          <p>Click the link below to reset your Lali password:</p>
          <p><a href="${url}" style="display:inline-block;padding:12px 24px;background:#e5484d;color:white;text-decoration:none;border-radius:8px;font-weight:600;">Reset Password</a></p>
          <p style="color:#888;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
        `,
      })
    },
  },
  advanced: {
    useSecureCookies: getSecret('NODE_ENV') === 'production',
    defaultCookieAttributes: {
      sameSite: 'lax',
    },
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for'],
    },
  },
})

export { db as authDb }
