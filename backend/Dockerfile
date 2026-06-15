# Node 22+ for native WebSocket (required by @supabase/supabase-js realtime client)
FROM node:22-slim

# sharp (EXIF stripping) needs these native libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (layer cached unless package.json changes)
COPY package.json ./
RUN npm install --omit=dev

COPY . .

# Data lives in Supabase (Postgres + Storage); /data/uploads is only a
# local-disk photo fallback when SUPABASE_* is unset.
RUN mkdir -p /data/uploads
ENV UPLOADS_DIR=/data/uploads
ENV PORT=3001
ENV NODE_ENV=production
# Bind all interfaces — required behind a PaaS/proxy (Koyeb, Render, Railway),
# which terminate TLS and forward to the container.
ENV BIND_ADDR=0.0.0.0

EXPOSE 3001

CMD ["node", "server.js"]
