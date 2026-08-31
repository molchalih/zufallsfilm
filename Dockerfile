FROM oven/bun:1.3.14-alpine
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY index.html tsconfig.json ./
RUN mkdir -p /data

# Last, so a new commit does not invalidate the install and copy layers above
# it. Defaulted rather than required: a local `docker build` is not a release
# and has no commit worth claiming. A runtime `APP_VERSION` still wins over it.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
ENV DB_PATH=/data/picker.sqlite
ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
