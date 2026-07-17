# License API (Hono + Drizzle + better-auth).
# Build context MUST be the license-server workspace root:
#   docker build -f deploy/api.Dockerfile .
# The npm lockfile lives only at the workspace root, so both workspace
# package.json files are copied before `npm ci -w`.

FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @sempdf/license-api
COPY apps/api apps/api
RUN npm run build -w @sempdf/license-api

FROM node:24-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @sempdf/license-api --omit=dev && npm cache clean --force
COPY --from=build /repo/apps/api/dist apps/api/dist
EXPOSE 8787
USER node
# Migrations (drizzle-kit push) run as a one-off deploy step (scripts/migrate.sh),
# never at container start.
CMD ["node", "apps/api/dist/index.js"]
