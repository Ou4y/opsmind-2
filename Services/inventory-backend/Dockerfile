# 1. Use an official Node.js runtime as a parent image
FROM node:18-alpine

# 2. Set the working directory inside the container
WORKDIR /usr/src/app

# 3. Copy package.json and package-lock.json first
COPY package*.json ./

# 4. Install dependencies
# (We install ALL dependencies, including dev, so ts-node works)
RUN npm install

# 5. Copy the rest of the application code
COPY . .

# 6. Expose the API port
EXPOSE 5000

# 7. Default command (This can be overridden in docker-compose)
CMD ["npm", "run", "api"]