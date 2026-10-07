FROM node:22-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json ./
# Copy frontend package files
COPY web/package.json web/package-lock.json ./web/

# Install all dependencies (frontend and backend)
RUN npm ci
RUN cd web && npm ci

# Copy source code
COPY . .

# Build frontend
RUN cd web && npm run build

# --- Production Image ---
FROM node:22-alpine

WORKDIR /app

# Install native dependencies for SQLite
RUN apk add --no-cache python3 make g++ 

# Copy package files and install ONLY production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy backend source
COPY src/ ./src/
COPY drizzle/ ./drizzle/
COPY drizzle.config.ts ./
COPY tsconfig.json ./

# Copy built frontend
COPY --from=builder /app/web/dist ./web/dist

# Expose port
EXPOSE 3000

# Set production env
ENV NODE_ENV=production
ENV PORT=3000

# Need to install tsx globally or locally for runtime (or use Node 22 native types)
RUN npm install -g tsx

# Start the server
CMD ["tsx", "src/server.ts"]
