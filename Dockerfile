# Stage 1 — Frontend build
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2 — Backend build
FROM golang:1.24-alpine AS backend-builder
WORKDIR /app/backend
# Copy frontend build output into the go:embed target directory
COPY --from=frontend-builder /app/frontend/build ./static/
COPY backend/go.mod backend/go.sum* ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -o /app/server ./cmd/server

# Stage 3 — Final image
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=backend-builder /app/server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
