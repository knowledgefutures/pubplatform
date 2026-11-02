#!/usr/bin/env bash
# Runs on the server, sent by .github/workflows/deploy-stack.yml over ssh:
#
#   bash -c "<this file>" deploy-remote deploy <repo> <commit> <image tag> <stack name> \
#     <public host> <stack file> <uses gateway> <registry user>
#   bash -c "<this file>" deploy-remote prune-previews "<PR numbers to keep>"
#
# deploy's stdin carries what must never be on a command line or on disk:
#   line 1     the job's GITHUB_TOKEN, to pull the images from ghcr.io
#   the rest   the app's values from the KF console (`kf ci secrets --runtime`):
#              KEY=value lines, ending with "# kf: end"
#
# The values stay in this shell's memory and reach Docker as the environment of
# `docker stack deploy`. Which services get which of them is a compose file
# generated here from their names alone and given on stdin, before the stack
# file: the stack file's own `environment:` entries win, as they did over the
# env_file this replaces. Swarm then keeps the values in each service's spec,
# which is how it passes environment to a container: `docker service inspect`
# on this host shows them to anyone with Docker here.
set -euo pipefail

ACTION="${1:?missing action}"
shift

# --- prune-previews: remove preview stacks whose PR is gone or unlabeled
if [[ "$ACTION" == prune-previews ]]; then
  KEEP=" ${1:-} "
  [[ "$KEEP" =~ ^[0-9\ ]*$ ]] || { echo "not PR numbers: $KEEP" >&2; exit 1; }
  for stack in $(sudo docker stack ls --format '{{.Name}}' | grep -E '^preview-pr-[0-9]+$' || true); do
    pr="${stack#preview-pr-}"
    if [[ "$KEEP" == *" $pr "* ]]; then
      echo "keeping $stack"
      continue
    fi
    echo "tearing down $stack"
    sudo docker stack rm "$stack"
    sleep 10
    sudo docker volume ls --filter "label=com.docker.stack.namespace=$stack" -q |
      xargs -r sudo docker volume rm || true
  done
  sudo docker image prune -f
  exit 0
fi

[[ "$ACTION" == deploy ]] || { echo "unknown action: $ACTION" >&2; exit 1; }

REPO="${1:?missing repo}"
SHA="${2:?missing commit}"
IMAGE_TAG="${3:?missing image tag}"
STACK_NAME="${4:?missing stack name}"
DEPLOY_HOST="${5:?missing public host}" # the public hostname, as the stack files call it
STACK_FILE="${6:?missing stack file}"
USES_GATEWAY="${7:?missing uses gateway}"
REGISTRY_USER="${8:?missing registry user}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "not a commit: $SHA" >&2; exit 1; }

# Which services get the app's values, by stack file: the ones that read
# .env.<stack> before. Every key, unless a list is given (`svc=KEY,KEY`).
case "$STACK_FILE" in
  stack.yml)
    SERVICES=(proxy=PUBSTAR_HOSTNAME platform platform-jobs site-builder "db=POSTGRES_USER,POSTGRES_PASSWORD,POSTGRES_DB")
    ;;
  stack.preview.yml)
    SERVICES=(platform platform-jobs site-builder "db=POSTGRES_USER,POSTGRES_PASSWORD,POSTGRES_DB" minio minio-init)
    ;;
  *)
    echo "unknown stack file: $STACK_FILE" >&2
    exit 1
    ;;
esac

# --- stdin: the registry token, then the values, all of it before anything else runs
IFS= read -r REGISTRY_TOKEN || { echo "no registry token on stdin" >&2; exit 1; }
[[ -n "$REGISTRY_TOKEN" ]] || { echo "no registry token on stdin" >&2; exit 1; }

declare -A VALUES=()
complete=0
while IFS= read -r line; do
  if [[ "$line" == "# kf: end" ]]; then
    complete=1
    break
  fi
  [[ -z "$line" || "$line" == \#* ]] && continue
  key="${line%%=*}"
  if [[ "$line" != *=* || ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "a line from kf is not KEY=value; nothing deployed" >&2
    exit 1
  fi
  # Names the shell, sudo, the dynamic loader, Go or the docker CLI read for
  # their own behaviour, and the ones this script interpolates into the stack
  # files, are never the app's: they would change the deploy, not the app.
  case "$key" in
    DOCKER_* | LD_* | SUDO_* | BASH_* | PATH | HOME | ENV | IFS | SHELLOPTS | PS4 | TMPDIR | \
      [Hh][Tt][Tt][Pp]_[Pp][Rr][Oo][Xx][Yy] | [Hh][Tt][Tt][Pp][Ss]_[Pp][Rr][Oo][Xx][Yy] | \
      [Nn][Oo]_[Pp][Rr][Oo][Xx][Yy] | [Aa][Ll][Ll]_[Pp][Rr][Oo][Xx][Yy] | SSL_CERT_* | \
      GODEBUG | GOTRACEBACK | GOMAXPROCS | GOGC | GOMEMLIMIT | \
      IMAGE_TAG | STACK_NAME | DEPLOY_HOST | ASSETS_HOST | PLATFORM_PORT | BUILDER_PORT | \
      MINIO_PORT | MINIO_CONSOLE_PORT | INBUCKET_PORT | MOCK_NOTIFY_PORT)
      echo "$key is a name the deploy itself reads; nothing deployed" >&2
      exit 1
      ;;
  esac
  VALUES["$key"]="${line#*=}"
done
if [[ "$complete" != 1 ]]; then
  echo "the values from kf were cut short; nothing deployed" >&2
  exit 1
fi
# Nothing after this reads the job's stdin.
exec </dev/null
echo "values for the app: ${!VALUES[*]}"

ASSETS_HOST="$DEPLOY_HOST"
if [[ "$DEPLOY_HOST" =~ ^pr-([0-9]+)\.pubstar\.org$ ]]; then
  ASSETS_HOST="pr-${BASH_REMATCH[1]}-assets.pubstar.org"
elif [[ "$DEPLOY_HOST" == "sandbox.pubstar.org" ]]; then
  ASSETS_HOST="sandbox-assets.pubstar.org"
fi

REPO_NAME="${REPO##*/}"
APP_DIR="/srv/${STACK_NAME}/${REPO_NAME}"
REPO_SSH="git@github.com:${REPO}.git"

# --- one deploy per stack at a time
LOCK_DIR="/tmp/deploy-locks"
LOCK_FILE="${LOCK_DIR}/${STACK_NAME}.lock"
LOCK_MAX_AGE=900
mkdir -p "$LOCK_DIR"

acquire_lock() {
  if [[ -f "$LOCK_FILE" ]]; then
    local lock_pid lock_age
    lock_pid="$(head -1 "$LOCK_FILE" 2>/dev/null || echo "")"

    if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
      lock_age=$(($(date +%s) - $(stat -c %Y "$LOCK_FILE" 2>/dev/null || echo "0")))

      if ((lock_age > LOCK_MAX_AGE)); then
        echo "stale lock held by pid $lock_pid for ${lock_age}s, removing"
        rm -f "$LOCK_FILE"
      else
        echo "::error::another deploy to ${STACK_NAME} is in progress (pid $lock_pid, age ${lock_age}s)"
        return 1
      fi
    else
      echo "lock owner (pid ${lock_pid:-?}) is gone, cleaning up stale lock"
      rm -f "$LOCK_FILE"
    fi
  fi

  echo "$$" >"$LOCK_FILE"
}

cleanup() {
  rm -f "$LOCK_FILE"
  # The job's token expires with the job; nothing needs it stored.
  sudo docker logout ghcr.io >/dev/null 2>&1 || true
}
trap cleanup EXIT

acquire_lock

# --- the checkout: the stack files at the commit being deployed
ssh-keyscan -H github.com >>~/.ssh/known_hosts 2>/dev/null
chmod 600 ~/.ssh/known_hosts

if [[ ! -d "${APP_DIR}/.git" ]]; then
  sudo mkdir -p "${APP_DIR}"
  sudo chown -R "$USER:$USER" "${APP_DIR}"
  git clone "${REPO_SSH}" "${APP_DIR}"
fi

cd "${APP_DIR}"
git fetch --prune --tags origin
git checkout --detach "${SHA}"

cd infra

# The plaintext env file an earlier deploy decrypted here with the server's age
# key. Nothing reads it now.
rm -f ".env.${STACK_NAME}"

for entry in "${SERVICES[@]}"; do
  grep -q "^  ${entry%%=*}:\$" "$STACK_FILE" || {
    echo "$STACK_FILE has no service ${entry%%=*}; deploy-remote.sh's list is stale" >&2
    exit 1
  }
done
if grep -qE '^ +env_file:' "$STACK_FILE"; then
  echo "$STACK_FILE still has an env_file; the values come from deploy-remote.sh" >&2
  exit 1
fi

# --- swarm, registry, image
if ! sudo docker info --format '{{.Swarm.LocalNodeState}}' | grep -qx active; then
  sudo docker swarm init --advertise-addr "$(hostname -I | awk '{print $1}')"
fi

printf '%s\n' "$REGISTRY_TOKEN" | sudo docker login ghcr.io -u "$REGISTRY_USER" --password-stdin
sudo docker pull ghcr.io/knowledgefutures/platform:"$IMAGE_TAG"

# --- the compose file that hands the values on: names only, no values
app_env_compose() {
  local entry svc names k set
  echo "services:"
  for entry in "${SERVICES[@]}"; do
    svc="${entry%%=*}"
    if [[ "$entry" == *=* ]]; then
      IFS=, read -r -a names <<<"${entry#*=}"
    else
      names=("${!VALUES[@]}")
    fi
    set=()
    for k in "${names[@]}"; do
      [[ -n "${VALUES[$k]+set}" ]] && set+=("$k")
    done
    echo "  ${svc}:"
    if ((${#set[@]} == 0)); then
      echo "    environment: []"
      continue
    fi
    echo "    environment:"
    for k in "${set[@]}"; do
      echo "      - \"${k}\""
    done
  done
}

# Interpolated into the stack files, beside the values.
PORTS=()
if [[ "$USES_GATEWAY" == "true" ]]; then
  echo "deploying gateway stack..."
  sudo docker stack deploy -c stack.gateway.yml --prune gateway

  for attempt in 1 2 3 4 5; do
    if sudo docker service update --force gateway_proxy; then
      break
    fi
    echo "gateway_proxy update attempt $attempt failed, retrying in 5s..."
    sleep 5
  done

  SUFFIX="${STACK_NAME##*-}"
  if [[ "$SUFFIX" =~ ^[0-9]+$ ]]; then
    PORT_NUM="$SUFFIX"
  else
    PORT_NUM="9000"
  fi

  PORTS=(
    "PLATFORM_PORT=1${PORT_NUM}" "BUILDER_PORT=2${PORT_NUM}" "MINIO_PORT=3${PORT_NUM}"
    "MINIO_CONSOLE_PORT=4${PORT_NUM}" "INBUCKET_PORT=5${PORT_NUM}" "MOCK_NOTIFY_PORT=6${PORT_NUM}"
  )
fi

# A subshell, so the values are in no other command's environment.
deploy_stack() (
  local k p keep=(IMAGE_TAG STACK_NAME DEPLOY_HOST ASSETS_HOST)
  for k in "${!VALUES[@]}"; do
    export "$k=${VALUES[$k]}"
    keep+=("$k")
  done
  for p in "${PORTS[@]}"; do
    export "${p?}"
    keep+=("${p%%=*}")
  done
  export IMAGE_TAG STACK_NAME DEPLOY_HOST ASSETS_HOST
  echo "deploying ${STACK_NAME} with IMAGE_TAG=${IMAGE_TAG}"
  app_env_compose | sudo --preserve-env="$(IFS=,; echo "${keep[*]}")" docker stack deploy \
    -c - -c "$STACK_FILE" --with-registry-auth --resolve-image always --prune "$STACK_NAME"
)
deploy_stack

sudo docker stack services "$STACK_NAME"
sudo docker image prune -f

dump_failure_info() {
  local svc="$1"
  echo ""
  echo "::group::service inspect ($svc)"
  # --pretty would print the service's environment: its values.
  sudo docker service inspect "$svc" --format '{{json .UpdateStatus}} {{json .Spec.Mode}}' 2>&1 || true
  echo "::endgroup::"

  echo "::group::task history ($svc)"
  sudo docker service ps "$svc" --no-trunc 2>&1 || true
  echo "::endgroup::"

  echo "::group::recent logs ($svc)"
  sudo docker service logs "$svc" --tail 200 --no-task-ids --timestamps 2>&1 || true
  echo "::endgroup::"
}

wait_rollout() {
  local svc="$1"
  local timeout="${2:-600}"
  local end=$((SECONDS + timeout))

  echo "waiting for rollout of $svc (timeout ${timeout}s)..."

  while ((SECONDS < end)); do
    local desired running state
    desired="$(sudo docker service inspect "$svc" --format '{{.Spec.Mode.Replicated.Replicas}}' 2>/dev/null || echo "")"
    running="$(sudo docker service ps "$svc" --filter desired-state=running --format '{{.CurrentState}}' 2>/dev/null | grep -c '^Running' || true)"
    state="$(sudo docker service inspect "$svc" --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{end}}' 2>/dev/null || echo "")"

    echo "  $svc: desired=$desired running=$running update_state=$state"

    if [[ "$state" == "rollback_started" || "$state" == "rollback_completed" ]]; then
      echo "::error::rollback detected for $svc (state=$state)"
      dump_failure_info "$svc"
      return 1
    fi

    if [[ -n "$desired" && "$running" == "$desired" ]] && { [[ -z "$state" ]] || [[ "$state" == "completed" ]]; }; then
      echo "  $svc rollout complete"
      return 0
    fi

    sleep 5
  done

  echo "::error::rollout timeout for $svc after ${timeout}s"
  dump_failure_info "$svc"
  return 1
}

wait_rollout "${STACK_NAME}_platform" 600
