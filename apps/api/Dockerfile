FROM node:24-alpine AS build
RUN apk add --no-cache postgresql17-client
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages packages
RUN npm ci --workspace @maktaba/api --include-workspace-root
COPY apps/api apps/api
RUN npm run build -w @maktaba/api
RUN mkdir -p /app/backups
CMD ["node","apps/api/dist/server.js"]
