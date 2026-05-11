#!/usr/bin/env bash
# sync-public.sh
# where: scripts/sync-public.sh
# what : SS_schedule/ から SS_Schedule_publish/ へ rsync で公開対象だけを同期し、
#        秘密文字列の混入をチェックする
# why  : 公開リポジトリへの秘密混入を多層防御で防ぎ、人為ミスを排除するため
#
# 使い方:
#   bash scripts/sync-public.sh             # 実同期
#   bash scripts/sync-public.sh --dry-run   # 何が同期されるか確認のみ
#   bash scripts/sync-public.sh --no-scan   # 秘密スキャンをスキップ（非推奨）

set -euo pipefail

# ── パス算出（スクリプトがどこから呼ばれても動くように）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
DST="$SRC/SS_Schedule_publish"
FILTER="$SRC/scripts/publish-filter.txt"

# ── 引数パース
DRY_RUN=false
DO_SCAN=true
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --no-scan) DO_SCAN=false ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# ── 前提チェック
[ -f "$FILTER" ] || { echo "ERROR: filter file not found: $FILTER" >&2; exit 1; }
[ -d "$DST" ]   || { echo "ERROR: destination not found: $DST (Phase 3 で git init 済の状態にしてください)" >&2; exit 1; }

# ── ヘッダ
echo "──────────────────────────────────────────"
echo "  publish-sync"
echo "  src   : $SRC"
echo "  dst   : $DST"
echo "  filter: $FILTER"
echo "  mode  : $($DRY_RUN && echo 'DRY RUN (no changes)' || echo 'APPLY')"
echo "──────────────────────────────────────────"

# ── rsync 実行
# CLI 引数の --exclude は filter file より先に評価される（保険として最重要除外を直接指定）
# DST 側の .git は絶対に消さない（--delete から守るため exclude）
RSYNC_ARGS=(
  -av --delete
  --exclude='.git/'
  --exclude='.claude/'
  --exclude='.agent/'
  --exclude='.vercel/'
  --exclude='.next/'
  --exclude='node_modules/'
  --exclude='SS_Schedule_publish/'
  --exclude='SS_Schedule_publish.bak/'
  --exclude='\[Codex\]/'
  --exclude='[Codex]/'
  --exclude='daily_report/'
  --exclude='docs/'
  --exclude='note_article/'
  --exclude='tasks/'
  --exclude='Plans.md'
  --exclude='CLAUDE.md'
  --exclude='Agent.md'
  --exclude='memo.md'
  --filter=". $FILTER"
)
$DRY_RUN && RSYNC_ARGS+=(--dry-run)

rsync "${RSYNC_ARGS[@]}" "$SRC/" "$DST/"

echo ""
echo "──────────────────────────────────────────"

# ── dry-run なら secret scan はしない（同期されてないので意味なし）
if $DRY_RUN; then
  echo "  ✅ dry-run 完了。実同期するには --dry-run を外して再実行してください。"
  exit 0
fi

# ── 秘密スキャン
if $DO_SCAN; then
  echo "  🔍 秘密スキャン中…"
  # よくあるパターン: KEY="..." / SECRET="..." / TOKEN=... の代入。
  # ただし .env*.example / .env*.template / コメント / マッチしない値（空 or プレースホルダ）は許容したい
  PATTERN='(GEMINI_API_KEY|AUTH_SECRET|AUTH_GOOGLE_SECRET|GOOGLE_CLIENT_SECRET|VERCEL_TOKEN|NEXT_PUBLIC_SUPABASE_ANON_KEY|STRIPE_SECRET_KEY|API_KEY|PRIVATE_KEY)[[:space:]]*=[[:space:]]*['"'"'"]?[A-Za-z0-9_\-]{16,}'

  # スキャン対象から テスト / example / template / lockfile / build artifact を除外
  # さらにヒット行のうち、明らかなプレースホルダ語を含むものは除外する
  HITS=$(cd "$DST" && grep -RIn -E "$PATTERN" . \
    --exclude-dir='.git' \
    --exclude-dir='node_modules' \
    --exclude-dir='.next' \
    --exclude-dir='__tests__' \
    --exclude-dir='e2e' \
    --exclude='*.example' \
    --exclude='*.template' \
    --exclude='*.test.ts' \
    --exclude='*.test.tsx' \
    --exclude='*.spec.ts' \
    --exclude='*.spec.tsx' \
    --exclude='package-lock.json' \
    --exclude='bun.lock' \
    --exclude='bun.lockb' \
    | grep -viE '(xxxx|yyyy|zzzz|your[-_]|<[^>]+>|example|dummy|fake|placeholder|sample|test[-_]|mock|FIXME|TODO)' \
    || true)

  if [ -n "$HITS" ]; then
    echo "  🚨 秘密らしき文字列を検出しました。push を中止してください。"
    echo "$HITS"
    exit 3
  fi
  echo "  ✅ 秘密スキャン: 問題なし"
else
  echo "  ⚠️  --no-scan により秘密スキャンをスキップしました"
fi

# ── 完了サマリ
echo ""
echo "  ✅ 同期完了"
echo "  次の手順:"
echo "    cd \"$DST\""
echo "    git status"
echo "    git diff --stat"
echo "    git add ."
echo "    git commit -m \"<message>\""
echo "    git push origin main"
echo "──────────────────────────────────────────"
