# Dev-only image: hot reload via tsx, source is bind-mounted by
# docker-compose. Not a production build - there's no deploy target yet
# to optimize a multi-stage image for.
FROM node:20-alpine

WORKDIR /app

COPY apps/api/package*.json ./
RUN npm install

COPY apps/api/ ./

EXPOSE 3000

CMD ["npm", "run", "dev"]
