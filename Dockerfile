# estorm CLI image, for rendering boards in CI.
#
#   docker build -t estorm .
#   docker run --rm -v "$PWD:/work" estorm render docs/*.estorm

FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# The CLI has no runtime dependencies: only the compiled files are needed.
FROM node:24-alpine
WORKDIR /opt/estorm
COPY --from=build /src/package.json ./
COPY --from=build /src/dist ./dist
RUN ln -s /opt/estorm/dist/cli.js /usr/local/bin/estorm && chmod +x dist/cli.js
USER node
WORKDIR /work
ENTRYPOINT ["estorm"]
CMD ["--help"]
