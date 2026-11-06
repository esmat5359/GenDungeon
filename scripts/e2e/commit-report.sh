#!/usr/bin/env bash
# Commits the newest LIVE end-to-end report.
#
#   bash scripts/e2e/commit-report.sh                 commit if every check passed
#   bash scripts/e2e/commit-report.sh --allow-failed  also commit a report that contains failures
#   bash scripts/e2e/commit-report.sh --push          push the current branch afterwards
#
# Simulation reports never match (their files end in -simulation) and reports of
# runs that were blocked or interrupted are always refused: they prove nothing.
set -euo pipefail
cd "$(dirname "$0")/../.."

allow_failed=0
push=0
for arg in "$@"; do
  case "$arg" in
    --allow-failed) allow_failed=1 ;;
    --push) push=1 ;;
    -h|--help) sed -n 2,11p "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

latest="$(ls -1t reports/e2e-*-live.json 2>/dev/null | head -n 1 || true)"
if [ -z "$latest" ]; then
  echo "No live report found in reports/. Run 'npm run e2e:live' first." >&2
  exit 1
fi

read -r status address passed failed < <(node -e '
  const fs = require("fs");
  const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  console.log([r.meta.status, r.meta.address || "none", r.summary.pass, r.summary.fail].join(" "));
' "$latest")

case "$status" in
  PASSED) ;;
  FAILED)
    if [ "$allow_failed" -ne 1 ]; then
      echo "The newest live report has $failed failing check(s). Fix the cause, or commit it as evidence with --allow-failed." >&2
      exit 1
    fi ;;
  *)
    echo "The newest live report is $status; it is not evidence about the contract and will not be committed." >&2
    exit 1 ;;
esac

base="${latest%.json}"
git add -f "$base.md" "$base.json" "$base.log" reports/LATEST-live.md
if git diff --cached --quiet; then
  echo "Nothing new to commit."
  exit 0
fi

git commit -m "docs(e2e): live end-to-end report ($status, $passed passed, $failed failed)" \
           -m "Contract $address. Report: ${base#reports/}.md"
echo "Committed ${base#reports/}.md"

if [ "$push" -eq 1 ]; then
  git push origin HEAD
fi
