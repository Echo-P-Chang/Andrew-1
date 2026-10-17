#!/usr/bin/env bash
# 使用 az login 的身分部署；不取得或儲存 publishing profile、密碼或 token。
set -euo pipefail

AZURE_SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-8a94a7cc-5cff-4be5-89a5-6854f2073765}"
AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-configreader-rg}"
AZURE_WEBAPP_NAME="${AZURE_WEBAPP_NAME:-Andrew-1}"
DEPLOY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_ONLY=""

usage() {
  cat <<'USAGE'
Usage: ./scripts/deploy-azure.sh [--package-only /path/to/app.zip]

Default: test, package, configure the existing Linux App Service for Node.js 24,
deploy and verify the released version. Authenticate first with az login.
--package-only builds a ZIP locally without Azure login or cloud changes.

Optional non-secret overrides:
  AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, AZURE_WEBAPP_NAME
USAGE
}
case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  --package-only)
    [[ $# -eq 2 && -n "$2" ]] || { usage >&2; exit 2; }
    PACKAGE_ONLY="$2" ;;
  "") [[ $# -eq 0 ]] || { usage >&2; exit 2; } ;;
  *) usage >&2; exit 2 ;;
esac

for dependency in node python3; do
  command -v "$dependency" >/dev/null || { echo "Missing dependency: $dependency" >&2; exit 1; }
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' || {
  echo 'Please install Node.js 22 or later.' >&2; exit 1;
}
DEPLOY_TMP="$(mktemp -d "${TMPDIR:-/tmp}/andrew-1-deploy.XXXXXX")"
trap 'rm -rf "$DEPLOY_TMP"' EXIT
DEPLOY_ZIP="$DEPLOY_TMP/app.zip"

echo 'Running tests...'
node --test "$DEPLOY_ROOT"/tests/*.test.cjs
echo 'Packaging only the game and its static server...'
python3 - "$DEPLOY_ROOT" "$DEPLOY_ZIP" <<'PY'
import hashlib
import json
import pathlib
import sys
import zipfile

root, destination = map(pathlib.Path, sys.argv[1:])
public_files = json.loads((root / 'hosting/public-files.json').read_text())
files = sorted(set(public_files + ['server.cjs', 'package.json', 'hosting/public-files.json']))
digest = hashlib.sha256()
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        file = root / name
        if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(root.resolve()):
            raise SystemExit(f'Invalid deployment file: {name}')
        content = file.read_bytes()
        digest.update(name.encode() + b'\0' + content + b'\0')
        archive.writestr(name, content)
    archive.writestr('hosting/release.json', json.dumps({'version': digest.hexdigest()}))
print(f'Packaged {len(files) + 1} files. Release: {digest.hexdigest()[:12]}')
PY

if [[ -n "$PACKAGE_ONLY" ]]; then
  mkdir -p "$(dirname "$PACKAGE_ONLY")"
  cp "$DEPLOY_ZIP" "$PACKAGE_ONLY"
  echo "Package ready: $PACKAGE_ONLY"
  exit 0
fi

command -v az >/dev/null || { echo 'Please install Azure CLI and run az login.' >&2; exit 1; }
az account show --query id --output tsv --only-show-errors >/dev/null || {
  echo 'Azure CLI is not signed in. Run az login and try again.' >&2; exit 1;
}
AZURE_ARGS=(--subscription "$AZURE_SUBSCRIPTION_ID" --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_WEBAPP_NAME" --only-show-errors)
IS_LINUX="$(az webapp show "${AZURE_ARGS[@]}" --query reserved --output tsv)"
[[ "$IS_LINUX" == 'true' ]] || { echo 'This script requires an existing Linux App Service.' >&2; exit 1; }
APP_HOST="$(az webapp show "${AZURE_ARGS[@]}" --query defaultHostName --output tsv)"
echo "Deploying to $AZURE_RESOURCE_GROUP/$AZURE_WEBAPP_NAME ($APP_HOST)..."
az webapp config set "${AZURE_ARGS[@]}" \
  --linux-fx-version 'NODE|24-lts' \
  --startup-file 'pm2 start /home/site/wwwroot/server.cjs --name andrew-1 --no-daemon' --output none
az webapp config appsettings set "${AZURE_ARGS[@]}" \
  --settings SCM_DO_BUILD_DURING_DEPLOYMENT=false ENABLE_ORYX_BUILD=false --output none
az webapp deploy "${AZURE_ARGS[@]}" --src-path "$DEPLOY_ZIP" --type zip \
  --clean true --restart true --track-status false --timeout 600000 --output none

echo 'Waiting for the deployed version to become healthy...'
python3 - "$APP_HOST" "$DEPLOY_ZIP" <<'PY'
import json
import sys
import time
import urllib.error
import urllib.request
import zipfile

host, package = sys.argv[1:]
with zipfile.ZipFile(package) as archive:
    expected = json.loads(archive.read('hosting/release.json'))['version']
last_error = 'Not ready'
for attempt in range(36):
    try:
        with urllib.request.urlopen(f'https://{host}/healthz', timeout=10) as response:
            health = json.load(response)
        if health.get('status') == 'ok' and health.get('version') == expected:
            with urllib.request.urlopen(f'https://{host}/', timeout=10) as response:
                html = response.read().decode('utf-8')
            if '注音打擊王' not in html:
                raise ValueError('The expected game was not served')
            print(f'Deployment verified: https://{host}/ (release {expected[:12]})')
            break
        last_error = 'The previous version is still being served'
    except (OSError, ValueError) as error:
        last_error = str(error)
    if attempt < 35:
        time.sleep(5)
else:
    raise SystemExit(f'Deployment uploaded, but verification failed: {last_error}')
PY
