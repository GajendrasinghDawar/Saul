import { betterAuth } from "better-auth";
import Database from "better-sqlite3";
import { Resend } from "resend";

const db = new Database("./lali-auth.db");

// Auto-create better-auth tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS "user" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    emailVerified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS "session" (
    id TEXT PRIMARY KEY,
    expiresAt TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    ipAddress TEXT,
    userAgent TEXT,
    userId TEXT NOT NULL REFERENCES "user"(id)
  );
  CREATE TABLE IF NOT EXISTS "account" (
    id TEXT PRIMARY KEY,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    userId TEXT NOT NULL REFERENCES "user"(id),
    accessToken TEXT,
    refreshToken TEXT,
    idToken TEXT,
    accessTokenExpiresAt TEXT,
    refreshTokenExpiresAt TEXT,
    scope TEXT,
    password TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS "verification" (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    createdAt TEXT,
    updatedAt TEXT
  );
`);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const fromEmail = "Lali <onboarding@resend.dev>";

export const auth = betterAuth({
  database: db,
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  trustedOrigins: [
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
  ],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      if (!resend) {
        console.log(`[Auth] Password reset link for ${user.email}: ${url}`);
        return;
      }
      await resend.emails.send({
        from: fromEmail,
        to: user.email,
        subject: "Reset your Lali password",
        html: `
          <h2>Reset your password</h2>
          <p>Hi ${user.name},</p>
          <p>Click the link below to reset your Lali password:</p>
          <p><a href="${url}" style="display:inline-block;padding:12px 24px;background:#e5484d;color:white;text-decoration:none;border-radius:8px;font-weight:600;">Reset Password</a></p>
          <p style="color:#888;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
        `,
      });
    },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },
});

export { db as authDb };

export function checkAuthHealth(): { status: "ok" | "error"; message?: string } {
  if (!process.env.BETTER_AUTH_SECRET) {
    return { status: "error", message: "Missing BETTER_AUTH_SECRET" };
  }
  return { status: "ok" };
}

export function checkDbHealth(): { status: "ok" | "error"; message?: string } {
  try {
    db.prepare("SELECT 1").get();
    return { status: "ok" };
  } catch {
    return { status: "error", message: "Auth database not ready" };
  }
}
