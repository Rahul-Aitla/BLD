FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# Set working directory
WORKDIR /app

# Install socat for port forwarding
RUN apt-get update && apt-get install -y socat && rm -rf /var/lib/apt/lists/*

# Copy package configuration files
COPY package*.json ./

# Install dependencies without downloading browsers (since they are built into the image)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install

# Copy the source and TS config files
COPY tsconfig.json ./
COPY src/ ./src/

# Build typescript compilation
RUN npm run build

# Expose HTTP health-check port and Chromium remote debugging port
EXPOSE 3000
EXPOSE 9222

# Start the application
CMD ["npm", "start"]
