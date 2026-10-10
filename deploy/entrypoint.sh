#!/bin/sh
set -eu
: "${ADMIN_PASSWORD:?ADMIN_PASSWORD is required}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
: "${GIT_REMOTE:=https://github.com/kyl619031313-sketch/personal-site.git}"
: "${HOST:=0.0.0.0}"
: "${PORT:=8787}"
: "${GIT_AUTHOR_NAME:?GIT_AUTHOR_NAME is required}"
: "${GIT_AUTHOR_EMAIL:?GIT_AUTHOR_EMAIL is required}"
export HOST PORT GIT_REMOTE
case "$GIT_REMOTE" in
  https://*) ;;
  *) echo 'GIT_REMOTE must be an HTTPS URL.' >&2; exit 1 ;;
esac
# Reject credentials in the URL. Never print the configured URL.
case "${GIT_REMOTE#https://}" in
  *@*|*\?*|*\#*) echo 'GIT_REMOTE must not contain credentials, query or fragment.' >&2; exit 1 ;;
esac
git config --global --add safe.directory /data/site
# Keep diagnostics in memory, then redact before displaying them.
auth_git() {
  node - "$@" <<'NODE'
const { spawnSync } = require('node:child_process');
const helper = 'credential.helper=!f() { echo username=x-access-token; echo "password=$GITHUB_TOKEN"; }; f';
const result = spawnSync('git', ['-c', 'credential.helper=', '-c', helper, ...process.argv.slice(2)], {
  encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
});
if (result.status !== 0) {
  const detail = `${result.error?.message || ''} ${result.stdout || ''} ${result.stderr || ''}`;
  console.error(detail.split(process.env.GITHUB_TOKEN).join('[REDACTED]'));
  process.exit(1);
}
NODE
}
if [ ! -d /data/site/.git ]; then
  auth_git clone --branch main --single-branch "$GIT_REMOTE" /data/site
else
  cd /data/site
  if [ -n "$(git status --porcelain)" ]; then
    echo 'Checkout has uncommitted changes. Resolve them before restarting.' >&2
    exit 1
  fi
  git remote set-url origin "$GIT_REMOTE"
  auth_git fetch origin main
  git checkout main
  if ! auth_git pull --ff-only origin main; then
    echo 'Cannot fast-forward main. Resolve the local/remote divergence before restarting.' >&2
    exit 1
  fi
fi
cd /data/site
git config --local user.name "$GIT_AUTHOR_NAME"
git config --local user.email "$GIT_AUTHOR_EMAIL"
exec node admin/server.mjs
