# OpsMind Frontend - Container image
# Serves static files without nginx

FROM node:20-alpine

WORKDIR /app

# Install a simple static file server
RUN npm -g install serve@14

# Copy static site content
COPY . .

EXPOSE 85

# Serve the site on port 85 inside the container
CMD ["serve", "-l", "85", "."]
