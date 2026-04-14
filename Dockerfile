# syntax=docker/dockerfile:1

# Comments are provided throughout this file to help you get started.
# If you need more help, visit the Dockerfile reference guide at
# https://docs.docker.com/go/dockerfile-reference/

ARG NODE_VERSION=22.13.1
ARG ALPINE_VERSION=3.20

ARG PACKAGE
ARG PORT=3000

ARG PNPM_VERSION=9.10.0


################################################################################
# Use node image for base image for all stages.
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base

# these are necessary to be able to use them inside of `base`
ARG BASE_IMAGE
ARG PNPM_VERSION


# Instll dependencies we need at the end
RUN apk add ca-certificates curl postgresql

# Setup RDS CA Certificates
RUN curl -L \
  -o  /usr/local/share/ca-certificates/rds-global-bundle.pem \
  https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  && update-ca-certificates

# Set working directory for all build stages.
WORKDIR /usr/src/app

# Install pnpm.
RUN --mount=type=cache,target=/root/.npm \
  npm install -g pnpm@${PNPM_VERSION}


FROM base AS fetch-deps


# Copy pnpm-lock.yaml so that we can use pnpm to install dependencies
COPY pnpm-lock.yaml ./

# Could possibly be sped up using `turbo prune`
# https://turbo.build/repo/docs/guides/tools/docker
RUN pnpm fetch

# Install dependencies we only need to run pnpm install
RUN apk add g++ make py3-pip

################################################################################
# Create a stage for building the application.
FROM fetch-deps AS monorepo

# Copy over the rest of the files
ADD . ./

# Install from the fetched store
RUN pnpm install -r --prefer-offline

RUN pnpm p:build

################################################################################
FROM monorepo AS withpackage

WORKDIR /usr/src/app

ARG PACKAGE

RUN test -n "$PACKAGE" || (echo "PACKAGE  not set, required for this target" && false)

ENV DOCKERBUILD=1

ARG CI
ENV CI=$CI

RUN --mount=type=secret,id=SENTRY_AUTH_TOKEN,env=SENTRY_AUTH_TOKEN \
  pnpm --filter $PACKAGE build

FROM withpackage AS prepare-jobs

ARG PACKAGE

RUN pnpm --filter $PACKAGE --prod deploy /tmp/app


FROM base AS jobs

ARG PACKAGE

WORKDIR /usr/src/app

COPY --from=prepare-jobs --chown=node:node /tmp/app .

# If the package is site-builder, create necessary directories and set permissions
RUN if [ "$PACKAGE" = "site-builder" ]; then \
  mkdir -p /usr/src/app/builds /usr/src/app/.astro /usr/src/app/dist && \
  chown -R node:node /usr/src/app/builds /usr/src/app/.astro /usr/src/app/dist; \
  fi

# very important, otherwise you will see obscure `dispatcher.getOwner` errors
ENV NODE_ENV=production

USER node

CMD ["pnpm", "start"]

################################################################################
# Create a new stage to run the application with minimal runtime dependencies
# where the necessary files are copied from the build stage.
# this is separated by package to make it slightly more clear what happens
# and because you cannot conditionally copy from a different folder
# based on the argument
FROM base AS prod-setup
ARG PORT


USER node

EXPOSE $PORT

ENV NODE_ENV=production

ENV HOSTNAME="0.0.0.0"

### Core

FROM prod-setup AS next-app-core
WORKDIR /usr/src/app
COPY --from=withpackage --chown=node:node /usr/src/app/core/.next/standalone ./
COPY --from=withpackage --chown=node:node /usr/src/app/core/.next/static ./core/.next/static
COPY --from=withpackage --chown=node:node /usr/src/app/core/public ./core/public
# migration sql files, applied automatically during startup instrumentation
COPY --from=withpackage --chown=node:node /usr/src/app/core/prisma/migrations ./core/prisma/migrations

CMD ["node", "--enable-source-maps", "core/server.js"]
