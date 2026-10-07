# Self-Hosting Saul: Deployment Troubleshooting & Hardening Guide

When deploying Saul for self-hosting (especially via Docker and Caddy), there are several subtle networking, security, and environment edge cases that can break the application. This document serves as a post-mortem of known issues and how they were resolved to ensure a hassle-free setup.

## 1. Network Binding & Vite Proxy (502 Bad Gateway)
**The Problem**: Locally, running `npm run dev` resulted in a `502 Bad Gateway` from the frontend when it tried to reach the backend auth endpoints.
**The Cause**: Modern Node.js (v17+) binds `localhost` to the IPv6 address `::1` by default on Windows. Vite's proxy configuration in `web/vite.config.ts` was hardcoded to proxy to `127.0.0.1` (IPv4). Since the backend wasn't listening on IPv4, the connection was refused.
**The Fix**: Updated `vite.config.ts` to proxy to `http://localhost:3000` so Node handles the IPv6/IPv4 resolution natively.

## 2. Express Trust Proxy (Rate Limiting Crashes)
**The Problem**: The backend occasionally threw `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` validation errors, causing requests to fail.
**The Cause**: The application runs behind Caddy (a reverse proxy). Caddy attaches the `X-Forwarded-For` header. The `express-rate-limit` package strictly validates this and throws an error if Express isn't explicitly configured to trust proxies.
**The Fix**: Added `app.set('trust proxy', 1)` to `src/app.ts` so Express correctly parses proxy headers.

## 3. Strict Security Headers on Insecure IPs
**The Problem**: Browsers threw console errors about `Cross-Origin-Opener-Policy` and `Origin-Agent-Cluster`.
**The Cause**: Helmet sets advanced security headers by default. Browsers consider raw IP addresses (like `http://13.127.147.239`) to be "untrustworthy origins". When they see strict security headers on an HTTP IP address, they refuse to process them.
**The Fix**: Ensure that when a user deploys, they immediately map a domain name so Caddy provisions HTTPS. If raw IPs must be supported, these Helmet headers must be conditionally disabled when `NODE_ENV !== 'production'` or when HTTPS is absent.

## 4. Secure Cookies Silently Dropped (401 Unauthorized)
**The Problem**: Users could log in successfully, but subsequent API calls returned `401 Unauthorized`.
**The Cause**: The deployment script set `NODE_ENV=production`. `better-auth` and the CSRF middleware detect production and automatically attach the `Secure` flag to session cookies. Because the site was being accessed over HTTP, the browser *silently dropped* the cookies, leaving the user unauthenticated on the very next request.
**The Fix**: Always use HTTPS (via Caddy Let's Encrypt) in production. If deploying over HTTP is absolutely necessary, the `useSecureCookies: false` and CSRF `secure: false` flags must be explicitly overridden.

## 5. Frontend `crypto.randomUUID` Crashes
**The Problem**: Sending a chat message failed with `TypeError: crypto.randomUUID is not a function`.
**The Cause**: The Web Crypto API (`crypto.randomUUID()`) is restricted to **Secure Contexts only** (HTTPS or `localhost`). When serving over a raw HTTP IP address, the browser completely disabled the API.
**The Fix**: Implemented a fallback in `web/src/features/chat/use-chat-session.ts` that falls back to `Math.random()` and `Date.now()` if `crypto.randomUUID` is undefined.

## 6. Email Reset Delivery Failures
**The Problem**: The "Forgot Password" flow did not send emails.
**The Cause**: The sender address in `auth.ts` was hardcoded to `onboarding@better-call-saul.ai`. Resend's free tier strictly blocks emails sent from unverified domains. Additionally, if the user trying to reset their password doesn't exist in the database (common when switching from local DB to a fresh production DB), `better-auth` silently ignores the request.
**The Fix**: Updated the sender email to `onboarding@resend.dev` for testing, and ensured users create accounts on the production DB before testing password resets.

## 7. Stale Frontend State (404 Conversation Not Found)
**The Problem**: The `/api/chat` endpoint returned `404 Not Found`.
**The Cause**: The user's browser had a URL cached like `/chat/1` from local testing. When pointing to the production server (which had a completely empty SQLite database), the frontend sent `conversationId: 1`. The backend couldn't find conversation `1`, causing it to correctly return a 404.
**The Fix**: Hard refresh the UI and navigate to the root `/` to force the backend to initialize a fresh conversation.

## 8. State Inconsistency & Silent Data Loss (404 Conversation Not Found)
**The Problem**: The `/api/chat` endpoint returned `404 Not Found` for existing chat sessions after a deployment or server restart, despite the user seeing their chat history in the sidebar.
**The Cause**: The backend relies on two distinct databases:
1. `local-turso.db`: Stores metadata (users, auth, `user_conversations` links).
2. `lali-durable.sqlite`: The Pi-Durable engine's internal state machine database (stores actual conversational memory and tasks).
In the Docker setup, `local-turso.db` was correctly placed inside the persistent volume (`/app/data/`), but `lali-durable.sqlite` was initialized in the app root (`/app/`). Whenever the Docker container rebuilt, the durable state was wiped, while the Turso DB survived. This resulted in orphaned `user_conversations` pointing to Pi-Durable sessions that no longer existed.
**The Fix**: Explicitly override the `storage` configuration in `src/setup/durable.ts` to point to the mounted volume (`./data/lali-durable.sqlite`).

## Hardening Recommendations for Self-Hosters
To prevent users from experiencing these when self-hosting Saul:
1. **Mandatory Domain**: Require users to provide a `DOMAIN` in `.env`. Do not officially support raw IP hosting in production, as it breaks Web Crypto and Secure Cookies.
2. **Schema Auto-Push**: Ensure the Docker startup script runs `npx drizzle-kit push` before starting the Node server so the SQLite database schema is always up-to-date.
3. **Graceful Error Handling**: Add a global Express error handler `(err, req, res, next)` to catch middleware crashes (like the rate-limiter one) and return clean JSON instead of crashing or returning HTML.
4. **Volume Mapping Checks**: Validate on startup that all SQLite database files (`local-turso.db` and `lali-durable.sqlite`) are physically located inside a directory that is mounted as a persistent volume (e.g., `/app/data`).
