# Docker CLI (to run ArchiveBox / auto-archiver as sibling containers via the
# mounted host socket) + Node 22 (native fetch for the Wayback SPN API).
FROM docker:27-cli AS dockercli

FROM node:22-slim
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

ENV POLL_INTERVAL_MS=15000
CMD ["node", "index.js"]
