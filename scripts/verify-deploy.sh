#!/usr/bin/env bash
# where: scripts/verify-deploy.sh
# what:  SS-013 デプロイ後の受け入れ基準を機械的に検証する CLI スクリプト
# why:   Vercel デプロイ完了後に手作業でチェックすると抜けが出るため、
#        4 項目（unauth 401 / CSRF 403 / CSRF 403|401 / JS バンドルキー漏洩）
#        を即時検証して PASS/FAIL を CI フレンドリーに返す。
#
# Usage: bash scripts/verify-deploy.sh https://ss-schedule.vercel.app
# Run after Vercel deploy completes. Checks SS-013 acceptance:
#  A. /api/calendar/list returns 401 (unauthenticated)
#  B. /api/extract POST cross-origin returns 403 (CSRF guard)
#  C. /api/calendar/insert POST cross-origin returns 403 or 401
#  D. No Gemini API key pattern leaked in served JS

set -euo pipefail

# ---------- arg parsing ----------
if [ "$#" -lt 1 ]; then
  echo "Usage: bash scripts/verify-deploy.sh <BASE_URL>" >&2
  echo "  e.g. bash scripts/verify-deploy.sh https://ss-schedule.vercel.app" >&2
  exit 2
fi

BASE_URL="${1%/}" # 末尾スラッシュ除去
EVIL_ORIGIN="https://evil.example.com"
GEMINI_KEY_REGEX='AIzaSy[A-Za-z0-9_-]\{33\}'

# ---------- color (optional, only if tput supports it) ----------
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

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  echo "${C_GREEN}[PASS]${C_RESET} $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "${C_RED}[FAIL]${C_RESET} $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

info() {
  echo "${C_YELLOW}[INFO]${C_RESET} $1"
}

excerpt() {
  # 先頭 200 文字に切り詰め、改行を除いて1行表示
  printf '%s' "$1" | tr '\n' ' ' | cut -c1-200
}

echo "=========================================="
echo " SS-013 deploy verification"
echo " BASE_URL: $BASE_URL"
echo "=========================================="

# ---------- A. /api/calendar/list unauth -> 401 ----------
echo
echo "--- A. unauth GET /api/calendar/list -> 401 ---"
A_RESP_FILE="$(mktemp -t verify_a.XXXXXX)"
A_STATUS="$(curl -sS -o "$A_RESP_FILE" -w '%{http_code}' "$BASE_URL/api/calendar/list" || echo "000")"
A_BODY="$(cat "$A_RESP_FILE")"
rm -f "$A_RESP_FILE"

info "status=$A_STATUS body=$(excerpt "$A_BODY")"
if [ "$A_STATUS" = "401" ] && printf '%s' "$A_BODY" | grep -q '"ok":false' && printf '%s' "$A_BODY" | grep -q '"error":"unauthorized"'; then
  pass "A: 401 + unauthorized body"
else
  fail "A: expected 401 with {\"ok\":false,\"error\":\"unauthorized\"} (got status=$A_STATUS)"
fi

# ---------- B. POST /api/extract cross-origin -> 403 ----------
echo
echo "--- B. cross-origin POST /api/extract -> 403 (CSRF) ---"
B_RESP_FILE="$(mktemp -t verify_b.XXXXXX)"
B_STATUS="$(curl -sS -o "$B_RESP_FILE" -w '%{http_code}' \
  -X POST \
  -H "Origin: $EVIL_ORIGIN" \
  -H "Content-Type: application/json" \
  --data '{"text":"probe"}' \
  "$BASE_URL/api/extract" || echo "000")"
B_BODY="$(cat "$B_RESP_FILE")"
rm -f "$B_RESP_FILE"

info "status=$B_STATUS body=$(excerpt "$B_BODY")"
if [ "$B_STATUS" = "403" ] && printf '%s' "$B_BODY" | grep -qi 'forbidden'; then
  pass "B: 403 + body contains 'forbidden'"
else
  fail "B: expected 403 with 'forbidden' in body (got status=$B_STATUS)"
fi

# ---------- C. POST /api/calendar/insert cross-origin -> 403 or 401 ----------
echo
echo "--- C. cross-origin POST /api/calendar/insert -> 403 or 401 ---"
C_RESP_FILE="$(mktemp -t verify_c.XXXXXX)"
C_STATUS="$(curl -sS -o "$C_RESP_FILE" -w '%{http_code}' \
  -X POST \
  -H "Origin: $EVIL_ORIGIN" \
  -H "Content-Type: application/json" \
  --data '{"calendarId":"primary","event":{"summary":"x","start":{"dateTime":"2030-01-01T00:00:00+09:00","timeZone":"Asia/Tokyo"},"end":{"dateTime":"2030-01-01T01:00:00+09:00","timeZone":"Asia/Tokyo"}}}' \
  "$BASE_URL/api/calendar/insert" || echo "000")"
C_BODY="$(cat "$C_RESP_FILE")"
rm -f "$C_RESP_FILE"

info "status=$C_STATUS body=$(excerpt "$C_BODY")"
if [ "$C_STATUS" = "403" ] || [ "$C_STATUS" = "401" ]; then
  pass "C: $C_STATUS (CSRF or auth guard fired first)"
else
  fail "C: expected 403 or 401 (got status=$C_STATUS)"
fi

# ---------- D. JS bundle does not leak GEMINI_API_KEY ----------
echo
echo "--- D. served JS does not contain Gemini API key pattern ---"
D_HOME_FILE="$(mktemp -t verify_d_home.XXXXXX)"
D_HOME_STATUS="$(curl -sS -L -o "$D_HOME_FILE" -w '%{http_code}' "$BASE_URL/" || echo "000")"
info "homepage status=$D_HOME_STATUS"

D_LEAK_FOUND=0
D_SCANNED_FILES=0

# (1) home HTML 自体をスキャン
if grep -qE "$(printf '%s' "$GEMINI_KEY_REGEX" | sed 's/\\{/{/g; s/\\}/}/g')" "$D_HOME_FILE" 2>/dev/null; then
  D_LEAK_FOUND=1
  info "leak pattern found in homepage HTML"
fi
D_SCANNED_FILES=$((D_SCANNED_FILES + 1))

# (2) homepage HTML から /_next/static/ の JS チャンク URL を抽出して 5 本までスキャン
CHUNKS="$(grep -oE '/_next/static/[A-Za-z0-9._/-]+\.js' "$D_HOME_FILE" 2>/dev/null | sort -u | head -n 5 || true)"
if [ -n "$CHUNKS" ]; then
  while IFS= read -r chunk; do
    [ -z "$chunk" ] && continue
    chunk_url="${BASE_URL}${chunk}"
    chunk_file="$(mktemp -t verify_d_chunk.XXXXXX)"
    chunk_status="$(curl -sS -o "$chunk_file" -w '%{http_code}' "$chunk_url" || echo "000")"
    info "chunk $chunk -> $chunk_status"
    if [ "$chunk_status" = "200" ]; then
      if grep -qE "$(printf '%s' "$GEMINI_KEY_REGEX" | sed 's/\\{/{/g; s/\\}/}/g')" "$chunk_file" 2>/dev/null; then
        D_LEAK_FOUND=1
        info "leak pattern found in $chunk"
      fi
      D_SCANNED_FILES=$((D_SCANNED_FILES + 1))
    fi
    rm -f "$chunk_file"
  done <<EOF
$CHUNKS
EOF
else
  info "no /_next/static chunks found in homepage HTML (best-effort scan)"
fi

rm -f "$D_HOME_FILE"

if [ "$D_LEAK_FOUND" -eq 0 ]; then
  pass "D: no Gemini key pattern in $D_SCANNED_FILES scanned file(s)"
else
  fail "D: Gemini API key pattern detected in served JS"
fi

# ---------- summary ----------
echo
echo "=========================================="
echo " Summary: PASS=$PASS_COUNT FAIL=$FAIL_COUNT"
echo "=========================================="

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
