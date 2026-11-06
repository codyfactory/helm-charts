#!/usr/bin/env bash
set -euo pipefail
chart=charts/cody-execution
values=examples/lint-values.yaml
rendered="$(helm template fixture "$chart" -f "$values")"
rg -q -- '--fresh-only' <<<"$rendered"
rg -q -- 'name: fixture-runtime-auth' <<<"$rendered"
rg -q -- 'name: fixture-installation-token' <<<"$rendered"
rg -q -- 'kind: Workflow' <<<"$rendered"
rg -q -- 'resourceID: "installation-fixture"' <<<"$rendered"
for invalid in 'installationTokenSecret=external' 'receipts.initializeOnInstall=false,onboarding.image='; do
  if helm template fixture "$chart" -f "$values" --set "$invalid" >/dev/null 2>&1; then
    echo "Invalid chart configuration unexpectedly rendered: $invalid" >&2
    exit 1
  fi
done
# Offline upgrade is refused when it cannot read the saved runtime key.
if helm template fixture "$chart" -f "$values" --is-upgrade --set receipts.initializeOnInstall=false >/dev/null 2>&1; then
  echo 'Offline upgrade generated a replacement runtime key' >&2
  exit 1
fi
external="$(helm template fixture "$chart" -f "$values" -f examples/existing-secrets.yaml --is-upgrade)"
if rg -q '^kind: Secret$|initialize-receipts' <<<"$external"; then
  echo 'Existing-Secret mode must neither own customer keys nor initialize retained storage' >&2
  exit 1
fi

rg -q 'name: fixture-execution-plane' <<<"$rendered"
rg -q -- '--execution-plane-url' <<<"$rendered"
rg -q -- '--runtime-token-file' <<<"$rendered"
rg -q -- '--asset-validation-directory' <<<"$rendered"
rg -q 'claimName: receipts-fixture-execution-plane-0' <<<"$rendered"
rg -q 'resources: \[agents/status\]' <<<"$rendered"
for retired in 'workerTokenSecret=old' 'sandbox.assetPullSecret=old' 'sandbox.assetGitSecret=old'; do
  if helm template fixture "$chart" -f "$values" --set "$retired" >/dev/null 2>&1; then
    echo "Retired value unexpectedly accepted: $retired" >&2
    exit 1
  fi
done
azure="$(helm template fixture "$chart" -f "$values" --set assetAccess.azure.tenantID=tenant,assetAccess.azure.clientID=client)"
rg -q 'audience: api://AzureADTokenExchange' <<<"$azure"
test "$(rg -c -- '--asset-access-config' <<<"$azure")" = 1
if helm template fixture "$chart" -f "$values" --set assetAccess.azure.clientID=client >/dev/null 2>&1; then
  echo 'Incomplete Azure identity unexpectedly accepted' >&2
  exit 1
fi
