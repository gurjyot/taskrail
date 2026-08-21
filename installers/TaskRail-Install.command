#!/bin/bash
set -Eeuo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This TaskRail installer is for macOS only." >&2
  exit 2
fi

for cmd in node npm curl; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Missing required command: $cmd" >&2; exit 3; }
done

node -e "const m=Number(process.versions.node.split('.')[0]); if(m<22){console.error('TaskRail requires Node.js 22 or newer');process.exit(1)}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
API="${TASKRAIL_RELEASE_API:-https://api.github.com/repos/gurjyot/taskrail/releases/latest}"

curl --fail --location --silent --show-error --retry 5 --retry-all-errors --connect-timeout 10 --max-time 120 "$API" -o "$TMP/release.json"
TAG="$(node -e "const r=require(process.argv[1]); if(!r.tag_name) process.exit(1); process.stdout.write(r.tag_name)" "$TMP/release.json")"
VERSION="${TAG#v}"
BASE="https://github.com/gurjyot/taskrail/releases/download/$TAG"

curl --fail --location --silent --show-error --retry 5 --retry-all-errors --connect-timeout 10 --max-time 120 "$BASE/taskrail-install-manifest.json" -o "$TMP/install-manifest.json"
ASSET="$(node -e "const m=require(process.argv[1]); if(m.taskrailVersion!==process.argv[2]) process.exit(2); process.stdout.write(m.framework.file)" "$TMP/install-manifest.json" "$VERSION")"
EXPECTED="$(node -e "const m=require(process.argv[1]); process.stdout.write(m.framework.sha256)" "$TMP/install-manifest.json")"

curl --fail --location --silent --show-error --retry 5 --retry-all-errors --connect-timeout 10 --max-time 300 "$BASE/$ASSET" -o "$TMP/$ASSET"
ACTUAL="$(node -e "const fs=require('fs'),c=require('crypto'); process.stdout.write(c.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))" "$TMP/$ASSET")"
[[ "$ACTUAL" == "$EXPECTED" ]] || { echo "TaskRail package checksum verification failed." >&2; exit 4; }

npm install -g "$TMP/$ASSET"
TASKRAIL_PLATFORM_MANIFEST_URL="https://raw.githubusercontent.com/gurjyot/taskrail/$TAG/platform-install/manifest.json" taskrail-platform-bootstrap install

taskrail --help >/dev/null
taskrail-platform-bootstrap status >/dev/null
echo "TaskRail $VERSION installed successfully for macOS."
