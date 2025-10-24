FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY server.js ./

# Expose port
EXPOSE 3001

# Set environment variables
ENV PORT=3001
ENV REDIS_URL=redis://redis:6379

# Run the server
CMD ["node", "server.js"]
