FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.html ./
COPY server.js ./
COPY src ./src
COPY storage ./storage
COPY README.md ./

RUN mkdir -p /app/storage

EXPOSE 3000

CMD ["npm", "start"]
