FROM node:24.2.0-alpine AS builder

WORKDIR /app

# Copy application source code
COPY app /app
RUN rm -rf node_modules dist

# Install dependencies and build
RUN npm install
ARG VITE_SYSTEM_NAME
RUN npm run build



################################
##### Production container #####
################################
FROM caddy:2.9.1-alpine AS prod

WORKDIR /app

COPY --from=builder /app/dist /app/dist
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 80
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile"]