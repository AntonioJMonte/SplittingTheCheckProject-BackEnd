# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
# Prisma's query engine links against OpenSSL; the slim image does not ship it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM build AS prod-deps
RUN npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app/package.json ./package.json
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
# D-106: the Prisma CLI is a production dependency, so `migrate deploy` runs here with the schema and migrations.
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3333
# Pending migrations are applied before the server starts; if one fails the server never comes up, and a platform
# health check keeps the previous deploy serving.
CMD ["npm", "run", "start:prod"]
