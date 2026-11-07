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

broker="$(helm template fixture "$chart" -f "$values" -f examples/broker.yaml --include-crds)"
rg -q 'name: fixture-broker-kubernetes' <<<"$broker"
rg -q -- '--broker-listen=:8444' <<<"$broker"
rg -q -- '--transport-mode=mesh' <<<"$broker"
rg -q -- '--feed-transport-mode=mesh' <<<"$broker"
rg -q -- '--broker-feed-transport-mode=mesh' <<<"$broker"
rg -q -- '--feed-url=http://fixture-broker-feed.default.svc.cluster.local:8444' <<<"$broker"
rg -q '"transportMode":"mesh"' <<<"$broker"
rg -q 'name: accessprofiles.execution.cody.so' <<<"$broker"
rg -q 'accessProfileRef:' <<<"$broker"
rg -q 'resources: \[accessprofiles/status\]' <<<"$broker"
rg -q 'resources: \[tokenreviews\]' <<<"$broker"
if rg -q 'fixture-broker-azure|serviceaccounts/token|impersonate|IDENTITY_ENDPOINT|api://AzureADTokenExchange|--tls-cert|--broker-tls-cert|--feed-ca|"identities"' <<<"$broker"; then
  echo 'Kubernetes-only mesh broker rendered privileged identity grants, TLS, or Azure access' >&2
  exit 1
fi
azure_broker="$(helm template fixture "$chart" -f "$values" -f examples/broker.yaml --set accessBroker.azure.enabled=true)"
rg -q 'name: fixture-broker-azure' <<<"$azure_broker"
test "$(rg -c -- '--kube-api-qps=20' <<<"$azure_broker")" = 2
test "$(rg -c -- '--kube-api-burst=40' <<<"$azure_broker")" = 2
broker_limits="$(helm template fixture "$chart" -f "$values" -f examples/broker.yaml --set accessBroker.azure.enabled=true,kubernetes.burst=25 --set-json kubernetes.qps=12.5)"
test "$(rg -c -- '--kube-api-qps=12.5' <<<"$broker_limits")" = 2
test "$(rg -c -- '--kube-api-burst=25' <<<"$broker_limits")" = 2
if rg -q 'serviceaccounts/token|impersonate' <<<"$azure_broker"; then
  echo 'Chart must not create admin-owned selected-identity grants' >&2
  exit 1
fi
for invalid in 'accessBroker.replicas=1' 'accessBroker.networkPolicy.externalEnforcementConfigured=false' 'accessBroker.enabled=false,accessBroker.azure.enabled=true' 'accessBroker.transport.mode=invalid' 'accessBroker.tlsSecret=unexpected' 'accessBroker.caSecret=unexpected' 'accessBroker.transport.mode=tls' 'accessBroker.identities[0].agentUID=retired'; do
  if helm template fixture "$chart" -f "$values" -f examples/broker.yaml --set "$invalid" >/dev/null 2>&1; then
    echo "Invalid broker configuration unexpectedly rendered: $invalid" >&2
    exit 1
  fi
done
plaintext="$(helm template fixture "$chart" -f "$values" -f examples/broker.yaml --set accessBroker.transport.mode=plaintext)"
rg -q -- '--transport-mode=plaintext' <<<"$plaintext"
rg -q -- '--broker-feed-transport-mode=plaintext' <<<"$plaintext"
tls="$(helm template fixture "$chart" -f "$values" -f examples/broker.yaml --set accessBroker.transport.mode=tls,accessBroker.tlsSecret=server-tls,accessBroker.feedTLSSecret=feed-tls,accessBroker.caSecret=trust)"
rg -q -- '--tls-cert=/etc/cody/broker-tls/tls.crt' <<<"$tls"
rg -q -- '--broker-tls-cert=/broker-feed-tls/tls.crt' <<<"$tls"
rg -q -- '--feed-url=https://fixture-broker-feed.default.svc.cluster.local:8444' <<<"$tls"
rg -q 'secretName: "trust"' <<<"$tls"
for invalid in 'accessBroker.tlsSecret=' 'accessBroker.feedTLSSecret='; do
  if helm template fixture "$chart" -f "$values" -f examples/broker.yaml --set accessBroker.transport.mode=tls,accessBroker.tlsSecret=server-tls,accessBroker.feedTLSSecret=feed-tls --set "$invalid" >/dev/null 2>&1; then
    echo "Incomplete TLS configuration unexpectedly rendered: $invalid" >&2
    exit 1
  fi
done
system_roots="$(helm template fixture "$chart" -f "$values" -f examples/broker.yaml --set accessBroker.transport.mode=tls,accessBroker.tlsSecret=server-tls,accessBroker.feedTLSSecret=feed-tls)"
if rg -q -- '--feed-ca|mountPath: /broker-ca' <<<"$system_roots"; then
  echo 'System-root TLS unexpectedly mounts an empty custom CA' >&2
  exit 1
fi
mixed="$(helm template fixture "$chart" -f "$values" -f examples/broker.yaml --set accessBroker.transport.brokerToFeed.mode=tls,accessBroker.feedTLSSecret=feed-tls,accessBroker.caSecret=trust)"
rg -q -- '--transport-mode=mesh' <<<"$mixed"
rg -q -- '--feed-transport-mode=tls' <<<"$mixed"
rg -q -- '--broker-tls-cert=/broker-feed-tls/tls.crt' <<<"$mixed"
if rg -q -- '--tls-cert=|mountPath: /broker-ca' <<<"$mixed"; then
  echo 'HTTP sandbox leg unexpectedly configures TLS' >&2
  exit 1
fi
managed="$(helm template fixture "$chart" -f "$values" -f examples/broker.yaml --set accessBroker.transport.mode=tls,accessBroker.issuerRef.name=internal,accessBroker.azure.enabled=true)"
test "$(rg -c '^kind: Certificate$' <<<"$managed")" = 2
rg -q 'secretName: fixture-broker-tls' <<<"$managed"
rg -q 'fixture-broker-azure.default.svc.cluster.local' <<<"$managed"
if helm template fixture "$chart" -f "$values" -f examples/broker.yaml --set accessBroker.transport.mode=tls,accessBroker.issuerRef.name=internal,accessBroker.tlsSecret=ambiguous >/dev/null 2>&1; then
  echo 'Mixed managed and existing TLS Secrets unexpectedly rendered' >&2
  exit 1
fi
cilium_broker="$(helm template fixture "$chart" -f "$values" -f examples/broker.yaml --set networkPolicy.enabled=true,accessBroker.networkPolicy.provider=cilium)"
rg -q 'kind: CiliumNetworkPolicy' <<<"$cilium_broker"
rg -q 'port: "8443"' <<<"$cilium_broker"
if rg -q 'matchName: management.azure.com|matchName: api.loganalytics.io' <<<"$cilium_broker"; then
  echo 'Kubernetes-only broker unexpectedly enables Azure network destinations' >&2
  exit 1
fi
rg -q -- '--broker-sandbox-service-account=fixture-sandbox' <<<"$broker"
rg -q -- '--sandbox-service-account=fixture-sandbox' <<<"$broker"
rg -q '^automountServiceAccountToken: false$' <<<"$broker"
if rg -q 'client-ca|client-signer|broker-client-ca|verbs: \[get, create, update, delete\]' <<<"$broker"; then
  echo 'Retired client-certificate provisioning unexpectedly rendered' >&2
  exit 1
fi
for mode in broker azure_broker; do
  rendered="${!mode}"
  binding="$(sed -n '/^kind: ClusterRoleBinding$/,/^---$/p' <<<"$rendered")"
  rg -q 'name: fixture-execution-plane' <<<"$binding"
  rg -q 'name: fixture-broker-kubernetes' <<<"$binding"
  if rg -q 'name: fixture-sandbox' <<<"$binding"; then
    echo 'Sandbox account unexpectedly receives TokenReview permissions' >&2
    exit 1
  fi
  if [[ "$mode" == azure_broker ]]; then
    rg -q 'name: fixture-broker-azure' <<<"$binding"
  elif rg -q 'name: fixture-broker-azure' <<<"$binding"; then
    echo 'Disabled Azure broker unexpectedly receives TokenReview permissions' >&2
    exit 1
  fi
done
