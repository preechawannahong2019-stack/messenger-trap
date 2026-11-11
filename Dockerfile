FROM node:20-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app
ENV DB_FILE=/app/data/trap.db
USER node
EXPOSE 3000
CMD ["node", "server.js"]
