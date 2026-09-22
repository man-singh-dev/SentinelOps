# Dev-only image: air rebuilds and restarts the worker on file change,
# the same hot-reload role tsx plays for api/web. Not a production build.
FROM golang:1.25-alpine

WORKDIR /app

RUN go install github.com/air-verse/air@v1.61.7

COPY apps/worker/go.mod ./
RUN go mod download

COPY apps/worker/ ./

CMD ["air", "-c", ".air.toml"]
