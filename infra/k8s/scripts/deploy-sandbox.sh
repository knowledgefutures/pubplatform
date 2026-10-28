#!/bin/bash
set -euo pipefail

IMAGE_TAG="${1:?missing IMAGE_TAG}"
ENV_FILE="${2:?missing ENV_FILE (path to decrypted .env file)}"

NAMESPACE="pubstar-sandbox"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
K8S_DIR="$(dirname "$SCRIPT_DIR")"

echo "deploying sandbox (image: ${IMAGE_TAG}) to namespace ${NAMESPACE}"

# create namespace
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

# create GHCR pull secret (idempotent)
if [ -n "${GHCR_USER:-}" ] && [ -n "${GHCR_TOKEN:-}" ]; then
  kubectl create secret docker-registry ghcr \
    --docker-server=ghcr.io \
    --docker-username="$GHCR_USER" \
    --docker-password="$GHCR_TOKEN" \
    --namespace="$NAMESPACE" \
    --dry-run=client -o yaml | kubectl apply -f -
fi

# create app secret from decrypted env file
kubectl create secret generic pubstar-env \
  --from-env-file="$ENV_FILE" \
  --namespace="$NAMESPACE" \
  --dry-run=client -o yaml | kubectl apply -f -

# build manifests, substitute image tag, apply
cd "${K8S_DIR}/overlays/sandbox"
kustomize edit set image \
  "ghcr.io/knowledgefutures/platform:${IMAGE_TAG}" \
  "ghcr.io/knowledgefutures/platform-jobs:${IMAGE_TAG}" \
  "ghcr.io/knowledgefutures/platform-site-builder:${IMAGE_TAG}" \
  "ghcr.io/knowledgefutures/mock-coar-notify-server:${IMAGE_TAG}"

kustomize build . | kubectl apply -n "$NAMESPACE" -f -

# reset kustomization.yaml image tags back to placeholder
git checkout -- kustomization.yaml 2>/dev/null || true

echo "waiting for core deployment rollout..."
kubectl rollout status deployment/core -n "$NAMESPACE" --timeout=600s

echo "sandbox deployed: https://sandbox.k3s.pubstar.org"
kubectl get all -n "$NAMESPACE"
