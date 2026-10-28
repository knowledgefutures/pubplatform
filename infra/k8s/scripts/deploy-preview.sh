#!/bin/bash
set -euo pipefail

PR_NUMBER="${1:?missing PR_NUMBER}"
IMAGE_TAG="${2:?missing IMAGE_TAG}"
ENV_FILE="${3:?missing ENV_FILE (path to decrypted .env file)}"

NAMESPACE="preview-pr-${PR_NUMBER}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
K8S_DIR="$(dirname "$SCRIPT_DIR")"

echo "deploying preview for PR #${PR_NUMBER} (image: ${IMAGE_TAG}) to namespace ${NAMESPACE}"

# create namespace
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
kubectl label namespace "$NAMESPACE" \
  pubstar.io/preview=true \
  pubstar.io/pr-number="$PR_NUMBER" \
  --overwrite

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

# build manifests, substitute placeholders, apply
kustomize build "${K8S_DIR}/overlays/preview" \
  | sed "s/__PR_NUMBER__/${PR_NUMBER}/g" \
  | sed "s/IMAGE_TAG/${IMAGE_TAG}/g" \
  | kubectl apply -n "$NAMESPACE" -f -

echo "waiting for core deployment rollout..."
kubectl rollout status deployment/core -n "$NAMESPACE" --timeout=600s

echo "preview deployed: https://pr-${PR_NUMBER}.k3s.pubstar.org"
kubectl get all -n "$NAMESPACE"
