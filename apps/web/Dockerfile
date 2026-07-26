FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages packages
RUN npm ci --workspace @maktaba/web --include-workspace-root
COPY apps/web apps/web
RUN npm run build -w @maktaba/web
FROM caddy:2-alpine
COPY --from=build /app/apps/web/dist /usr/share/caddy
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
