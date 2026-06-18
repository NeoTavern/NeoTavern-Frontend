FROM node:20-alpine

RUN apk add --no-cache git socat dos2unix

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build:deploy

EXPOSE 8787

COPY docker/entrypoint.sh /entrypoint.sh

RUN dos2unix /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "8787"]
