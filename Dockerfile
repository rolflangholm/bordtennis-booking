FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public
ENV NODE_ENV=production PORT=8040 DATA_FILE=/data/bookings.json
VOLUME /data
EXPOSE 8040
USER node
CMD ["node", "server.js"]
