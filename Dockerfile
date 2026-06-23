FROM node:20-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on (Cloud Run expects PORT environment variable, defaults to 8080)
ENV PORT 8080
EXPOSE 8080

# Command to run the application
CMD ["npm", "start"]
