# License dashboard (Vite SPA) served by nginx.
# Build context MUST be the license-server workspace root:
#   docker build -f deploy/web.Dockerfile .
# nginx proxies /v1 + /api/auth to the API container (API_UPSTREAM env),
# so the OVH load balancer only needs one backend (web:80).

FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @a11ydocs/license-dashboard
COPY apps/web apps/web
RUN npm run build -w @a11ydocs/license-dashboard

FROM nginx:1.29-alpine
# nginx's entrypoint envsubsts *.template into /etc/nginx/conf.d at start.
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
ENV API_UPSTREAM=http://api:8787
EXPOSE 80
