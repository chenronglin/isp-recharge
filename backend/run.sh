#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="isp-recharge-backend"
BUN_BIN="${BUN_BIN:-bun}"
RUN_DIR="${SCRIPT_DIR}/run"
LOG_DIR="${SCRIPT_DIR}/logs"
PID_FILE="${RUN_DIR}/${APP_NAME}.pid"
LOG_FILE="${LOG_DIR}/${APP_NAME}.log"

mkdir -p "${RUN_DIR}" "${LOG_DIR}"

is_running() {
  if [[ ! -f "${PID_FILE}" ]]; then
    return 1
  fi

  local pid
  pid="$(cat "${PID_FILE}")"

  if [[ -z "${pid}" ]]; then
    return 1
  fi

  if kill -0 "${pid}" >/dev/null 2>&1; then
    return 0
  fi

  rm -f "${PID_FILE}"
  return 1
}

start_service() {
  if is_running; then
    echo "${APP_NAME} is already running with PID $(cat "${PID_FILE}")."
    return 0
  fi

  if ! command -v "${BUN_BIN}" >/dev/null 2>&1; then
    echo "bun is not installed or not found in PATH."
    exit 1
  fi

  echo "Starting ${APP_NAME}..."
  cd "${SCRIPT_DIR}"
  nohup "${BUN_BIN}" run start >>"${LOG_FILE}" 2>&1 &
  local pid=$!
  echo "${pid}" >"${PID_FILE}"

  sleep 1

  if kill -0 "${pid}" >/dev/null 2>&1; then
    echo "${APP_NAME} started successfully with PID ${pid}."
    echo "Log file: ${LOG_FILE}"
    return 0
  fi

  rm -f "${PID_FILE}"
  echo "Failed to start ${APP_NAME}. Check log: ${LOG_FILE}"
  exit 1
}

stop_service() {
  if ! is_running; then
    echo "${APP_NAME} is not running."
    return 0
  fi

  local pid
  pid="$(cat "${PID_FILE}")"
  echo "Stopping ${APP_NAME} (PID ${pid})..."
  kill "${pid}" >/dev/null 2>&1 || true

  for _ in {1..20}; do
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      rm -f "${PID_FILE}"
      echo "${APP_NAME} stopped."
      return 0
    fi
    sleep 1
  done

  echo "Process did not exit after 20 seconds, sending SIGKILL..."
  kill -9 "${pid}" >/dev/null 2>&1 || true
  rm -f "${PID_FILE}"
  echo "${APP_NAME} stopped."
}

status_service() {
  if is_running; then
    echo "${APP_NAME} is running with PID $(cat "${PID_FILE}")."
    echo "Log file: ${LOG_FILE}"
    return 0
  fi

  echo "${APP_NAME} is not running."
  return 1
}

restart_service() {
  stop_service
  start_service
}

usage() {
  cat <<EOF
Usage: $0 {start|stop|restart|status}

Commands:
  start    Start the backend service in the background
  stop     Stop the backend service
  restart  Restart the backend service
  status   Show current service status
EOF
}

case "${1:-}" in
  start)
    start_service
    ;;
  stop)
    stop_service
    ;;
  restart)
    restart_service
    ;;
  status)
    status_service
    ;;
  *)
    usage
    exit 1
    ;;
esac
