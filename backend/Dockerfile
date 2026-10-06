FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=4020 \
    SETAREH_HTTP_HOST=0.0.0.0 \
    SETAREH_TRANSPORT=http \
    SETAREH_DATABASE_PATH=/data/setareh.db

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && mkdir /data \
  && chown node:node /data
COPY --from=build /app/dist ./dist

USER node
EXPOSE 4020
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node --input-type=module -e "const response = await fetch('http://127.0.0.1:' + process.env.PORT + '/health'); process.exit(response.ok ? 0 : 1)"

CMD ["node", "dist/index.js"]
