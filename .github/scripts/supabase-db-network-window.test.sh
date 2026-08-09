#!/usr/bin/env bash

set -euo pipefail

curl() {
  local last_argument="${*: -1}"
  case "$last_argument" in
    */v1/open)
      printf '%s' '{"ok":true,"state":"open","runnerCidr":"8.8.8.8/32"}'
      ;;
    */v1/close)
      printf '%s' '{"ok":true,"state":"closed"}'
      ;;
    *)
      return 22
      ;;
  esac
}

jq() {
  local filter=''
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -r)
        shift
        ;;
      *)
        filter="$1"
        shift
        ;;
    esac
  done
  case "$filter" in
    '.ok // false')
      printf '%s\n' true
      ;;
    '.runnerCidr // ""')
      printf '%s\n' '8.8.8.8/32'
      ;;
    *)
      return 2
      ;;
  esac
}

export -f curl jq
export SUPABASE_NETWORK_GATE_URL='https://gate.example'
export SUPABASE_NETWORK_GATE_TOKEN='test-token'

output_file="$(mktemp)"
trap 'rm -f "$output_file"' EXIT
export GITHUB_OUTPUT="$output_file"

bash .github/scripts/supabase-db-network-window.sh open >/dev/null
grep -Fx 'runner_cidr=8.8.8.8/32' "$output_file" >/dev/null
bash .github/scripts/supabase-db-network-window.sh close >/dev/null

echo 'Network window client smoke test passed.'
