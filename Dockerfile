FROM node:18-alpine


WORKDIR /app


RUN apk add --no-cache python3 make g++ git wget ca-certificates


COPY package.json ./
COPY tsconfig.json ./


RUN npm install


COPY ./src ./src
COPY ./server ./server
COPY ./main.ts ./


RUN mkdir -p /secrets


ENV MNEE_COSIGNER_URL='' \
  FIREBLOCKS_SECRET_KEY_PATH='/secrets/fireblocks_secret.key' \
  FIREBLOCKS_API_KEY='' \
  MNEE_COSIGNER_AUTH_TOKEN='' \
  MNEE_LOG_LEVEL='INFO' \
  PORT=3000


EXPOSE 3000


CMD ["npm", "start"]