FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run db:generate

EXPOSE 4010

CMD ["npm", "start"]
