#!/usr/bin/env bash
set -euo pipefail
chart=charts/cody-execution
values=examples/lint-values.yaml
rendered="$(helm template fixture "$chart" -f "$values")"
rg -q -- '--fresh-only' <<<"$rendered"
rg -q -- 'name: fixture-worker-auth' <<<"$rendered"
rg -q -- 'name: fixture-installation-token' <<<"$rendered"
rg -q -- 'kind: Workflow' <<<"$rendered"
rg -q -- 'resourceID: "installation-fixture"' <<<"$rendered"
for invalid in 'installationTokenSecret=external' 'receipts.initializeOnInstall=false,onboarding.image='; do
  if helm template fixture "$chart" -f "$values" --set "$invalid" >/dev/null 2>&1; then
    echo "Invalid chart configuration unexpectedly rendered: $invalid" >&2
    exit 1
  fi
done
# Offline upgrade is refused when it cannot read the saved worker key.
if helm template fixture "$chart" -f "$values" --is-upgrade --set receipts.initializeOnInstall=false >/dev/null 2>&1; then
  echo 'Offline upgrade generated a replacement worker key' >&2
  exit 1
fi
external="$(helm template fixture "$chart" -f "$values" -f examples/existing-secrets.yaml --is-upgrade)"
if rg -q '^kind: Secret$|initialize-receipts' <<<"$external"; then
  echo 'Existing-Secret mode must neither own customer keys nor initialize retained storage' >&2
  exit 1
fi
