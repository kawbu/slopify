FROM node:20-slim

WORKDIR /workspace

# Install basic dev tools
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the project
COPY . .

# Expose port for local testing server
EXPOSE 3000

# Default command
CMD ["npm", "run", "serve"]