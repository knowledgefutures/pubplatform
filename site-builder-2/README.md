# Site Builder Service

This service provides an API to build static sites and upload them to an S3-compatible storage service.

## Prerequisites

- Docker and Docker Compose
- Node.js 22+ (for local development)

## Getting Started

Run `pnpm server:dev` to start the server in development mode.

The server receives build requests from the Platform, fetches pub content via the Platform API, generates static files (HTML, JSON, XML, etc.), and uploads them to S3.

Currently there is no seed in `core` that works properly with the site-builder.

You will need to import a community.

### Environment Variables

Use the `.env.development` and `.env.server.development` files as a baseline to set your environment variables.

You can set `.env.development.local` and `.env.server.development.local` to override the environment variables for local development.

### Running with Docker Compose

This is to test production-like behavior.

1. Start the service:

```bash
docker-compose up -d
```

2. The service will be available at http://localhost:4000
3. MinIO console will be available at http://localhost:9001 (login with MINIO_ROOT_USER/MINIO_ROOT_PASSWORD)
