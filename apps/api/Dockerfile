FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages packages
RUN npm ci --workspace @maktaba/api --include-workspace-root
COPY apps/api apps/api
RUN npm run build -w @maktaba/api
CMD ["node","apps/api/dist/server.js"]
