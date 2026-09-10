# Dev-only image: Vite dev server with HMR, source is bind-mounted by
# docker-compose. Not a production build.
FROM node:20-alpine

WORKDIR /app

COPY apps/web/package*.json ./
RUN npm install

COPY apps/web/ ./

EXPOSE 5173

CMD ["npm", "run", "dev"]
