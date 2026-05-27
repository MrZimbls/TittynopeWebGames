# WebGames — production image (Vue static + Express/Socket.IO)
FROM node:22-alpine AS client-build
WORKDIR /build
COPY client/package.json client/package-lock.json ./client/
COPY shared ./shared
WORKDIR /build/client
RUN npm ci
COPY client/ ./
# Empty = same origin as the page (recommended behind one tunnel hostname)
ARG VITE_SERVER_URL=
ENV VITE_SERVER_URL=$VITE_SERVER_URL
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache curl
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV STATIC_DIR=/app/public

COPY server/package.json server/package-lock.json ./server/
WORKDIR /app/server
RUN npm ci --omit=dev && npm install tsx@4.19.4 --no-save

WORKDIR /app
COPY server/src ./server/src
COPY shared ./shared
COPY --from=client-build /build/client/dist ./public

WORKDIR /app/server
EXPOSE 3000
CMD ["npx", "tsx", "src/index.ts"]
