FROM oven/bun:1.3.14-alpine
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY index.html tsconfig.json ./
RUN mkdir -p /data
ENV DB_PATH=/data/picker.sqlite
ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
