FROM node:20-alpine
WORKDIR /srv
COPY package.json package-lock.json* ./
RUN npm install --omit=dev || (echo "No lockfile present, installing from package.json" && npm install --omit=dev)
COPY . .
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]