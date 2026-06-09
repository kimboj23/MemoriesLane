FROM node:20-slim

# sharp (EXIF stripping) needs these native libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (layer cached unless package.json changes)
COPY package.json ./
RUN npm install --omit=dev

COPY . .

# /data is where Railway mounts a persistent volume.
# DB file and uploaded photos both live here so they survive redeploys.
RUN mkdir -p /data/uploads
ENV DB_PATH=/data/memories.db
ENV UPLOADS_DIR=/data/uploads
ENV PORT=3001
ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "server.js"]
