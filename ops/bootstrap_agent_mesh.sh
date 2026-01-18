#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

log() {
  printf "%s [%s] %s\n" "$(timestamp)" "$1" "$2"
}

die() {
  log "ERROR" "$1"
  exit 1
}

REPO_URL="${REPO_URL:-}"
REPO_DIR="${REPO_DIR:-/opt/glassbox/uOttaHacks2026}"
REPO_BRANCH="${REPO_BRANCH:-main}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_PATH="${VENV_PATH:-.venv}"
ENV_FILE="${ENV_FILE:-agent-mesh/.env}"
RUN_DOCKER_BROKER="${RUN_DOCKER_BROKER:-true}"
BROKER_CONTAINER="${BROKER_CONTAINER:-solace}"
BROKER_IMAGE="${BROKER_IMAGE:-solace/solace-pubsub-standard:latest}"
BROKER_SHM_SIZE="${BROKER_SHM_SIZE:-1g}"
BROKER_NOFILE="${BROKER_NOFILE:-1048576:1048576}"
BROKER_PORTS="${BROKER_PORTS:--p 8080:8080 -p 55555:55555 -p 8008:8008 -p 55443:55443}"
BROKER_RECREATE="${BROKER_RECREATE:-true}"
RUN_AGENT_MESH="${RUN_AGENT_MESH:-true}"
RUN_AS_SERVICE="${RUN_AS_SERVICE:-false}"
OVERWRITE_ENV="${OVERWRITE_ENV:-false}"

log "INFO" "Starting bootstrap."

log "INFO" "Installing base packages."
sudo apt update -y
sudo apt install -y git "${PYTHON_BIN}" "${PYTHON_BIN}-venv"

if [[ -d "${REPO_DIR}/.git" ]]; then
  log "INFO" "Repo already present; fetching updates."
  git -C "${REPO_DIR}" fetch --all --prune
  git -C "${REPO_DIR}" checkout "${REPO_BRANCH}"
  git -C "${REPO_DIR}" pull --ff-only
else
  [[ -n "${REPO_URL}" ]] || die "REPO_URL is required when repo is not present."
  log "INFO" "Cloning repo to ${REPO_DIR}."
  sudo mkdir -p "${REPO_DIR%/*}"
  sudo chown "${USER}:${USER}" "${REPO_DIR%/*}"
  git clone "${REPO_URL}" "${REPO_DIR}"
  git -C "${REPO_DIR}" checkout "${REPO_BRANCH}"
fi

log "INFO" "Setting up virtual environment."
if [[ ! -d "${REPO_DIR}/${VENV_PATH}" ]]; then
  "${PYTHON_BIN}" -m venv "${REPO_DIR}/${VENV_PATH}"
fi
"${REPO_DIR}/${VENV_PATH}/bin/pip" install --upgrade pip
"${REPO_DIR}/${VENV_PATH}/bin/pip" install -r "${REPO_DIR}/agent-mesh/requirements.txt"

ENV_TARGET="${REPO_DIR}/${ENV_FILE}"
if [[ -f "${ENV_TARGET}" && "${OVERWRITE_ENV}" != "true" ]]; then
  log "INFO" "Env file exists at ${ENV_TARGET}; skipping write."
else
  log "INFO" "Writing env file to ${ENV_TARGET}."
  cat > "${ENV_TARGET}" <<EOF
NAMESPACE="${NAMESPACE:-glassbox-dev}"
GLASSBOX_API_BASE_URL="${GLASSBOX_API_BASE_URL:-}"
GLASSBOX_BACKEND_AUTH_MODE="${GLASSBOX_BACKEND_AUTH_MODE:-service_token}"
GLASSBOX_SERVICE_TOKEN="${GLASSBOX_SERVICE_TOKEN:-}"
GLASSBOX_GATEWAY_SHARED_SECRET="${GLASSBOX_GATEWAY_SHARED_SECRET:-}"
YELLOWCAKE_API_KEY="${YELLOWCAKE_API_KEY:-}"
PLATFORM_API_HOST="${PLATFORM_API_HOST:-0.0.0.0}"
PLATFORM_API_PORT="${PLATFORM_API_PORT:-8001}"
SOLACE_BROKER_URL="${SOLACE_BROKER_URL:-ws://localhost:8008}"
SOLACE_BROKER_USERNAME="${SOLACE_BROKER_USERNAME:-default}"
SOLACE_BROKER_PASSWORD="${SOLACE_BROKER_PASSWORD:-default}"
SOLACE_BROKER_VPN="${SOLACE_BROKER_VPN:-default}"
LLM_SERVICE_ENDPOINT="${LLM_SERVICE_ENDPOINT:-}"
LLM_SERVICE_API_KEY="${LLM_SERVICE_API_KEY:-}"
LLM_SERVICE_GENERAL_MODEL_NAME="${LLM_SERVICE_GENERAL_MODEL_NAME:-}"
LLM_SERVICE_PLANNING_MODEL_NAME="${LLM_SERVICE_PLANNING_MODEL_NAME:-}"
LLM_REPORT_MODEL_NAME="${LLM_REPORT_MODEL_NAME:-}"
AWS_REGION="${AWS_REGION:-}"
EOF
fi

if [[ "${RUN_DOCKER_BROKER}" == "true" ]]; then
  log "INFO" "Ensuring Docker is installed and running."
  if ! command -v docker >/dev/null 2>&1; then
    sudo apt install -y docker.io
  fi
  sudo systemctl enable --now docker
  if sudo docker ps -a --format "{{.Names}}" | grep -qx "${BROKER_CONTAINER}"; then
    if [[ "${BROKER_RECREATE}" == "true" ]]; then
      log "INFO" "Removing existing broker container ${BROKER_CONTAINER}."
      sudo docker rm -f "${BROKER_CONTAINER}"
    else
      log "INFO" "Starting existing broker container ${BROKER_CONTAINER}."
      sudo docker start "${BROKER_CONTAINER}"
    fi
  fi
  if ! sudo docker ps --format "{{.Names}}" | grep -qx "${BROKER_CONTAINER}"; then
    log "INFO" "Launching broker container ${BROKER_CONTAINER}."
    sudo docker run -d --name "${BROKER_CONTAINER}" \
      --shm-size="${BROKER_SHM_SIZE}" --ulimit "nofile=${BROKER_NOFILE}" \
      ${BROKER_PORTS} \
      "${BROKER_IMAGE}"
  fi
fi

if [[ "${RUN_AGENT_MESH}" == "true" ]]; then
  missing=()
  for var in \
    GLASSBOX_API_BASE_URL \
    GLASSBOX_SERVICE_TOKEN \
    LLM_SERVICE_ENDPOINT \
    LLM_SERVICE_GENERAL_MODEL_NAME \
    LLM_SERVICE_PLANNING_MODEL_NAME \
    LLM_REPORT_MODEL_NAME; do
    if [[ -z "${!var:-}" ]]; then
      missing+=("${var}")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    log "ERROR" "Missing required env vars for agent-mesh: ${missing[*]}"
    exit 1
  fi

  if [[ "${RUN_AS_SERVICE}" == "true" ]]; then
    log "INFO" "Installing systemd service."
    sudo tee /etc/systemd/system/glass-box-gateway.service >/dev/null <<SERVICE
[Unit]
Description=Glass Box Gateway (Solace Agent Mesh)
After=network.target

[Service]
Type=simple
WorkingDirectory=${REPO_DIR}/agent-mesh
EnvironmentFile=${ENV_TARGET}
ExecStart=${REPO_DIR}/${VENV_PATH}/bin/solace-agent-mesh run
Restart=on-failure
RestartSec=5
User=${USER}
Group=${USER}

[Install]
WantedBy=multi-user.target
SERVICE
    sudo systemctl daemon-reload
    sudo systemctl enable --now glass-box-gateway.service
    log "INFO" "Service started. Use: sudo systemctl status glass-box-gateway.service"
  else
    log "INFO" "Starting agent-mesh in foreground."
    cd "${REPO_DIR}/agent-mesh"
    "${REPO_DIR}/${VENV_PATH}/bin/solace-agent-mesh" run
  fi
fi

log "INFO" "Bootstrap complete."
