FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
ENV HOST=0.0.0.0 PORT=3182
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3182
CMD ["sh", "-c", "npm run migrate && npm start"]
