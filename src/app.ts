import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { doubleCsrf } from "csrf-csrf";
import { toNodeHandler } from "better-auth/node";
import type { Harness } from "@earendil-works/pi-durable";
import { createChatRouter } from "./routes/chat.ts";
import { createTasksRouter } from "./routes/tasks.ts";
import { createConversationsRouter } from "./routes/conversations.ts";

export type AppDependencies = {
  harness: Harness;
  auth: any;
  modelConfig: {
    providerName: string;
    modelId: string;
  };
};

export function createApp(dependencies: AppDependencies) {
  const { auth } = dependencies;
  const app = express();

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
      },
    },
  }));
  app.use(express.json({ limit: "10kb" }));
  app.use(cookieParser(process.env.COOKIE_SECRET || "lali-secret"));

  // Better Auth handler - must be before CSRF
  app.use("/api/auth", toNodeHandler(auth));

  // CSRF protection
  // @ts-ignore
  const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
    getSecret: () => process.env.CSRF_SECRET || "csrf-secret",
    getSessionIdentifier: (req: express.Request) => {
      return (req as any).cookies?.["better-auth.session_token"] || "unknown";
    },
    cookieName: "x-csrf-token",
    cookieOptions: {
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
    },
  });

  const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10000 });

  // CSRF token endpoint (no auth needed)
  app.get("/csrf-token", (req, res) => {
    res.json({ csrfToken: generateCsrfToken(req, res) });
  });

  // Auth middleware - protects all remaining API routes
  app.use(async (req, res, next) => {
    if (req.path === "/" || req.path === "/health" || req.path === "/csrf-token") return next();
    if (req.path.startsWith("/api/auth")) return next();

    try {
      const session = await auth.api.getSession({ headers: new Headers(req.headers as Record<string, string>) });
      if (!session) {
        return res.status(401).json({ error: "ERR_UNAUTH", message: "Authentication required" });
      }
      res.locals.userId = session.user.id;
      next();
    } catch {
      return res.status(500).json({ error: "ERR_AUTH", message: "Auth check failed" });
    }
  });

  // Mount Feature Routes
  app.use("/api", createChatRouter(dependencies, doubleCsrfProtection, apiLimiter));
  app.use("/api/tasks", createTasksRouter(dependencies));
  app.use("/api/conversations", createConversationsRouter(dependencies));

  return app;
}
