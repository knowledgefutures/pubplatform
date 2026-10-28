#!/bin/bash
set -euo pipefail

PR_NUMBER="${1:?missing PR_NUMBER}"
NAMESPACE="preview-pr-${PR_NUMBER}"

echo "tearing down preview for PR #${PR_NUMBER} (namespace: ${NAMESPACE})"

if kubectl get namespace "$NAMESPACE" &>/dev/null; then
  kubectl delete namespace "$NAMESPACE"
  echo "namespace ${NAMESPACE} deleted"
else
  echo "namespace ${NAMESPACE} not found, nothing to tear down"
fi
