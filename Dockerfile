FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/package-lock.json ./web/
RUN npm ci && npm ci --prefix web
COPY web/ ./web/
RUN npm run build --prefix web

FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./server/
COPY --from=builder /app/web/dist ./web/dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/server.ts"]
