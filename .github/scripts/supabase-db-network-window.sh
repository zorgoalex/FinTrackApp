#!/usr/bin/env bash

set -euo pipefail

fail() {
  echo "Network window error: $*" >&2
  exit 1
}

require_configuration() {
  [ -n "${SUPABASE_NETWORK_GATE_URL:-}" ] || fail "SUPABASE_NETWORK_GATE_URL is missing"
  [ -n "${SUPABASE_NETWORK_GATE_TOKEN:-}" ] || fail "SUPABASE_NETWORK_GATE_TOKEN is missing"
  [[ "$SUPABASE_NETWORK_GATE_URL" =~ ^https://[^/]+/?$ ]] || fail "SUPABASE_NETWORK_GATE_URL must be an HTTPS origin without a path"
}

call_gate() {
  local operation="$1"
  local response
  response="$(curl \
    --ipv4 \
    --fail-with-body \
    --silent \
    --show-error \
    --retry 4 \
    --retry-all-errors \
    --connect-timeout 10 \
    --max-time 90 \
    --request POST \
    --header "Authorization: Bearer ${SUPABASE_NETWORK_GATE_TOKEN}" \
    --header 'Content-Type: application/json' \
    "${SUPABASE_NETWORK_GATE_URL%/}/v1/${operation}")"

  [ "$(jq -r '.ok // false' <<<"$response")" = 'true' ] || fail "network gate did not confirm ${operation}"
  printf '%s' "$response"
}

open_window() {
  local response runner_cidr
  response="$(call_gate open)"
  runner_cidr="$(jq -r '.runnerCidr // ""' <<<"$response")"
  [[ "$runner_cidr" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/32$ ]] || fail "network gate returned an invalid runner CIDR"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "runner_cidr=${runner_cidr}" >>"$GITHUB_OUTPUT"
  fi
  echo "Temporary database network window opened for one GitHub runner IPv4."
}

close_window() {
  call_gate close >/dev/null
  echo "Database network window closed; direct PostgreSQL access is denied."
}

require_configuration

case "${1:-}" in
  open)
    open_window
    ;;
  close)
    close_window
    ;;
  *)
    fail "usage: $0 open|close"
    ;;
esac
