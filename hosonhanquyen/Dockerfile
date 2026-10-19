FROM node:22.21-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY lib ./lib
COPY public ./public
USER node
EXPOSE 3903
ENV BIND_ADDR=0.0.0.0
CMD ["node", "server.js"]
