FROM node:22-bookworm-slim
WORKDIR /home/container
COPY package.json package-lock.json ./
# TypeScript is a devDependency required for the Open Ticket runtime compilation.
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
RUN mkdir -p /data && chown -R node:node /home/container /data
ENV NODE_ENV=production
USER node
CMD ["node", "scripts/coolify-start.js"]
