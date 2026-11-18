# syntax=docker/dockerfile:1

# ---------- 构建 ----------
FROM node:22-alpine AS build
WORKDIR /app
ENV CI=1

COPY package.json package-lock.json ./
COPY packages ./packages
COPY games ./games
COPY site ./site
COPY play ./play
COPY public ./public
COPY scripts ./scripts
COPY index.html tsconfig.json vite.config.ts vite.standalone.config.ts ./

RUN npm ci --no-audit --no-fund
RUN npm run build

# ---------- 运行 ----------
FROM nginx:1.31-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
