# Gateway: serves the built frontend and runs every proxy (same code as `vite dev`).
# Build context = repo root. VITE_* values are PUBLIC (publishable key) and are baked
# into the browser bundle at build time, so they are build args.
FROM node:22-alpine AS build
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
RUN npm run build && npm run build:server

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 DIST_DIR=/srv/dist
WORKDIR /srv
COPY --from=build /app/dist /srv/dist
COPY --from=build /app/dist-server/index.cjs /srv/index.cjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "/srv/index.cjs"]
