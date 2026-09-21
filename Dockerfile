# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- base
FROM node:24-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ----------------------------------------------------------------- dev
# Vite dev server with hot reloading. The source is bind-mounted by compose.
FROM base AS dev
ENV PORT=5173
EXPOSE 5173
CMD ["npm", "run", "dev"]

# --------------------------------------------------------------- build
FROM base AS build
COPY . .
RUN npm run build

# ------------------------------------------------------------ production
# Static files only — the app has no server side.
FROM nginx:alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
