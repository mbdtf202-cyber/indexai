#!/usr/bin/env bash
# IndexAI 的 Ralph 构建循环：每轮把 PROMPT_build.md 交给一个全新上下文的 Claude，
# 它完成 IMPLEMENTATION_PLAN.md 里的一个任务、提交后退出，然后进入下一轮。
#
# 用法：bash loop.sh [最大轮数，默认 10]
# 停止：Ctrl+C；Ralph 写出 .ralph/DONE；连续两轮异常；连续三轮没有新提交。
set -euo pipefail
cd "$(dirname "$0")"

MAX="${1:-10}"
LOG_DIR=".ralph/logs"
DONE_FLAG=".ralph/DONE"

die() { echo "loop.sh: $*" >&2; exit 1; }

[[ "$MAX" =~ ^[1-9][0-9]*$ ]] || die "最大轮数必须是正整数"
command -v claude >/dev/null 2>&1 || die "找不到 claude 命令行"
command -v gh >/dev/null 2>&1 || die "找不到 gh 命令行（里程碑结束时要开 PR）"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' 2>/dev/null \
  || die "需要 Node 24 或更高版本"

BRANCH="$(git branch --show-current)"
[[ "$BRANCH" == ralph/* ]] || die "只能在 ralph/* 分支上运行（当前：${BRANCH:-detached HEAD}）"
[[ -z "$(git status --porcelain)" ]] || die "工作区有未提交的改动，先处理干净"

# Ralph 不持有生产密钥：环境变量与本机 wrangler 登录态都不允许存在
for v in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CF_API_TOKEN; do
  [[ -z "$(printenv "$v" || true)" ]] || die "环境里不应有 $v"
done
for f in "$HOME/Library/Preferences/.wrangler/config/default.toml" \
         "$HOME/.config/.wrangler/config/default.toml" \
         "$HOME/.wrangler/config/default.toml"; do
  [[ ! -f "$f" ]] || die "检测到 wrangler 登录态（$f），先运行 npx wrangler logout，或在容器里运行"
done

mkdir -p "$LOG_DIR"
rm -f "$DONE_FLAG"

fails=0
stalls=0
for ((i = 1; i <= MAX; i++)); do
  before="$(git rev-parse HEAD)"
  log="$LOG_DIR/$(date +%Y%m%d-%H%M%S)-$i.jsonl"
  echo "── 第 $i/$MAX 轮 · $BRANCH · $log"

  if claude -p --dangerously-skip-permissions --model opus \
       --output-format stream-json --verbose < PROMPT_build.md > "$log"; then
    fails=0
  else
    fails=$((fails + 1))
    echo "本轮异常退出（连续 $fails 次），日志见 $log" >&2
    [[ $fails -lt 2 ]] || die "连续两轮异常，停止"
  fi

  git push -u origin "$BRANCH" >/dev/null 2>&1 || echo "推送失败，下一轮再试" >&2

  if [[ -f "$DONE_FLAG" ]]; then
    echo "没有可做的任务：$(cat "$DONE_FLAG")"
    exit 0
  fi

  if [[ "$(git rev-parse HEAD)" == "$before" ]]; then
    stalls=$((stalls + 1))
    echo "本轮没有新提交（连续 $stalls 次）" >&2
    [[ $stalls -lt 3 ]] || die "连续三轮没有进展，停止。先看 IMPLEMENTATION_PLAN.md 的「发现」"
  else
    stalls=0
  fi
done

echo "已跑满 $MAX 轮。"
