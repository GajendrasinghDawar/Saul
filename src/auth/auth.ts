import { betterAuth } from "better-auth";
import Database from "better-sqlite3";
import { Resend } from "resend";

const db = new Database("./lali-auth.db");

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
