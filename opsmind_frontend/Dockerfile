# OpsMind Frontend - Container image
# Serves static files without nginx

FROM node:20-alpine

WORKDIR /app

# Install a simple static file server
RUN apk add --no-cache gettext && npm -g install serve@14

# Copy static site content
COPY . .

RUN sed -i 's/\r//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

EXPOSE 85

# Render runtime config from environment and serve the site
ENTRYPOINT ["/app/docker-entrypoint.sh"]
