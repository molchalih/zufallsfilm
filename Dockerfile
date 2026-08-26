FROM oven/bun:1.3.14-alpine
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY tsconfig.json ./
RUN mkdir -p /data
ENV DB_PATH=/data/picker.sqlite
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
