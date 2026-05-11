#!/usr/bin/env bash
# where: scripts/vercel-env-setup.sh
# what:  Reads .env.vercel.local and pushes each KEY=VALUE to Vercel as
#        Production / Preview / Development env vars (overwriting existing).
# why:   Vercel CLI lacks a bulk-import command; this script bridges the gap so
#        all 5 SS-013 env vars land in one shot, matching what /Settings/Env Vars
#        UI would do via "Import .env File". Run after `vercel link`.
#
# Usage: bash scripts/vercel-env-setup.sh
#
# Prereqs:
#   1. vercel login   # one-time
#   2. vercel link    # link this dir to a Vercel project (interactive)
#   3. cp .env.vercel.template .env.vercel.local && fill values

set -euo pipefail

ENV_FILE=".env.vercel.local"
TARGETS=(production preview development)

# ---------- color (optional) ----------
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  C_GREEN="$(tput setaf 2)"
  C_RED="$(tput setaf 1)"
  C_YELLOW="$(tput setaf 3)"
  C_RESET="$(tput sgr0)"
else
  C_GREEN=""
  C_RED=""
  C_YELLOW=""
  C_RESET=""
fi

info() { echo "${C_YELLOW}[INFO]${C_RESET} $1"; }
ok()   { echo "${C_GREEN}[OK]${C_RESET}   $1"; }
err()  { echo "${C_RED}[ERR]${C_RESET}  $1" >&2; }

# ---------- preconditions ----------
if [ ! -f "$ENV_FILE" ]; then
  err "$ENV_FILE not found."
  err "Hint: cp .env.vercel.template $ENV_FILE && edit values."
  exit 1
fi

if ! command -v vercel >/dev/null 2>&1; then
  err "vercel CLI not found on PATH."
  err "Hint: npm i -g vercel  (or: bun add -g vercel)"
  exit 1
fi

# ---------- main loop ----------
SET_COUNT=0
SKIP_COUNT=0

while IFS= read -r raw_line || [ -n "$raw_line" ]; do
  # 改行末尾 CR 除去
  line="${raw_line%$'\r'}"
  # 空行 / コメント行 skip
  case "$line" in
    ''|\#*) continue ;;
  esac
  # KEY=VALUE 以外の行は skip
  case "$line" in
    *=*) ;;
    *) continue ;;
  esac

  key="${line%%=*}"
  value="${line#*=}"
  # KEY 前後の空白除去（簡易）
  key="$(printf '%s' "$key" | tr -d '[:space:]')"

  if [ -z "$key" ]; then
    continue
  fi

  if [ -z "$value" ]; then
    info "$key has empty value — skipping."
    SKIP_COUNT=$((SKIP_COUNT + 1))
    continue
  fi

  for env_target in "${TARGETS[@]}"; do
    # Vercel CLI v50+ non-interactive: preview env requires explicit git-branch
    # arg (empty string "" = "all preview branches"). production / development
    # have no branch concept. --force overwrites existing values; --yes skips
    # the confirmation prompt. --value passes the value via flag (avoids stdin
    # quirks across CLI versions).
    if [ "$env_target" = "preview" ]; then
      add_args=("$key" preview "")
    else
      add_args=("$key" "$env_target")
    fi
    # `</dev/null` redirects vercel CLI's stdin so it does NOT consume the
    # outer while-loop's input file. Without this, only the first KEY gets
    # processed and the rest of the .env.vercel.local lines silently disappear.
    if vercel env add "${add_args[@]}" --value "$value" --force --yes </dev/null >/dev/null 2>&1; then
      ok "$key set for $env_target"
      SET_COUNT=$((SET_COUNT + 1))
    else
      err "failed to set $key for $env_target"
      exit 1
    fi
  done
done < "$ENV_FILE"

echo
echo "=========================================="
echo " vercel-env-setup summary"
echo "  set:     $SET_COUNT (key×env pairs)"
echo "  skipped: $SKIP_COUNT (empty value)"
echo "=========================================="
echo
echo "Next: vercel deploy --prod"
