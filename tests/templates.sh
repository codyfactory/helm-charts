#!/usr/bin/env bash
set -euo pipefail
chart=charts/cody-execution
values=examples/lint-values.yaml
validate_documents() {
  awk '
    function check() {
      if ((versions || kinds) && (versions != 1 || kinds != 1)) {
        print "Rendered YAML document must contain exactly one apiVersion and kind" > "/dev/stderr"
        invalid = 1
      }
      versions = kinds = 0
    }
    /^---[[:space:]]*$/ { check() }
    /^apiVersion:/ { versions++ }
    /^kind:/ { kinds++ }
    END { check(); exit invalid }
  '
}
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
controller_rbac="$(helm template fixture "$chart" -f "$values" -f examples/broker.yaml --show-only templates/rbac.yaml)"
rg -U -q 'resources: \[serviceaccounts\]\n    verbs: \[get\]' <<<"$controller_rbac"
test "$(rg -c 'resources: \[pods, serviceaccounts\]' <<<"$azure_broker")" = 2
rg -U -q 'resources: \[pods, serviceaccounts\]\n    verbs: \[get, watch\]' <<<"$azure_broker"
if rg -q 'resourceNames:' <<<"$controller_rbac"; then
  echo 'Controller ServiceAccount metadata lookup unexpectedly requires per-profile grants' >&2
  exit 1
fi
rg -U -q 'resources: \[serviceaccounts\]\n    resourceNames: \[sre-reader\]\n    verbs: \[impersonate\]' examples/access-profile.yaml
rg -U -q 'resources: \[serviceaccounts/token\]\n    resourceNames: \[sre-reader\]\n    verbs: \[create\]' examples/access-profile-azure-rbac.yaml
if rg -q 'sre-profile-resolver|verbs: \[get, watch\]' examples/access-profile.yaml examples/access-profile-azure-rbac.yaml; then
  echo 'Profile examples unexpectedly require metadata observation grants' >&2
  exit 1
fi
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
managed="$(helm template fixture "$chart" -f "$values" -f examples/broker.yaml --set accessBroker.transport.mode=tls,accessBroker.issuerRef.name=internal,accessBroker.caSecret=trust,accessBroker.azure.enabled=true)"
test "$(rg -c '^kind: Certificate$' <<<"$managed")" = 2
rg -q '"caFile":"/broker-ca/ca.crt"' <<<"$managed"
rg -q -- '--feed-ca=/etc/cody/feed-ca/ca.crt' <<<"$managed"
if helm template fixture "$chart" -f "$values" -f examples/broker.yaml --set accessBroker.transport.mode=tls,accessBroker.issuerRef.name=internal >/dev/null 2>&1; then
  echo 'Managed TLS without a CA Secret unexpectedly rendered' >&2
  exit 1
fi
rg -q 'secretName: fixture-broker-tls' <<<"$managed"
rg -q 'fixture-broker-azure.default.svc.cluster.local' <<<"$managed"
if helm template fixture "$chart" -f "$values" -f examples/broker.yaml --set accessBroker.transport.mode=tls,accessBroker.issuerRef.name=internal,accessBroker.caSecret=trust,accessBroker.tlsSecret=ambiguous >/dev/null 2>&1; then
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

for azure in false true; do
  for transport in mesh plaintext tls; do
    args=(--set "networkPolicy.enabled=true,accessBroker.networkPolicy.provider=cilium,accessBroker.azure.enabled=$azure,accessBroker.transport.mode=$transport")
    if [[ "$transport" == tls ]]; then
      args+=(--set accessBroker.tlsSecret=server-tls,accessBroker.feedTLSSecret=feed-tls,accessBroker.caSecret=trust)
    fi
    helm template fixture "$chart" -f "$values" -f examples/broker.yaml "${args[@]}" | validate_documents
  done
done

github="$(helm template fixture "$chart" -f "$values" -f examples/github-broker.yaml)"
rg -q -- '--mode=github' <<<"$github"
rg -q -- '--github-broker-service-account=default/fixture-broker-github' <<<"$github"
rg -q '"githubEndpoint":"https://fixture-broker-github.default.svc.cluster.local"' <<<"$github"
rg -q 'name: fixture-github-broker' <<<"$github"
printf '%s\n' "$github" | validate_documents
for invalid in 'networkPolicy.toolDomains[0]=github.com' 'networkPolicy.toolDomains[0]=api.github.com' 'accessBroker.enabled=false' 'accessBroker.github.upstreamHosts={}' ; do
  if helm template fixture "$chart" -f "$values" -f examples/github-broker.yaml --set "$invalid" >/dev/null 2>&1; then
    echo "Invalid GitHub configuration rendered: $invalid" >&2
    exit 1
  fi
done
fixture_hosts="$(helm template fixture "$chart" -f "$values" -f examples/github-broker.yaml --set 'accessBroker.github.upstreamHosts={forge.fixture,api.forge.fixture}')"
rg -q 'matchName: "forge.fixture"' <<<"$fixture_hosts"
if helm template fixture "$chart" -f "$values" -f examples/github-broker.yaml --set 'accessBroker.github.upstreamHosts={forge.fixture,api.forge.fixture}' --set 'networkPolicy.toolDomains[0]=forge.fixture' >/dev/null 2>&1; then
  echo 'Connector-host bypass unexpectedly rendered' >&2
  exit 1
fi

if helm template fixture "$chart" -f "$values" -f examples/github-broker.yaml --set 'accessBroker.github.upstreamHosts={Forge.Fixture,API.Forge.Fixture}' --set 'networkPolicy.toolDomains[0]=forge.fixture' >/dev/null 2>&1; then
  echo 'Case-equivalent connector-host bypass unexpectedly rendered' >&2
  exit 1
fi

broker_policy="$(awk 'BEGIN { RS="---" } /name: fixture-github-broker/ { print }' <<<"$github")"
for domain in codeload.github.com '*.githubusercontent.com' '*.blob.core.windows.net'; do
  test "$(rg -c -F "\"$domain\"" <<<"$broker_policy")" = 3
done
rg -q -F 'matchName: "codeload.github.com"' <<<"$broker_policy"
rg -q -F 'matchPattern: "*.githubusercontent.com"' <<<"$broker_policy"
rg -q -F 'matchPattern: "*.blob.core.windows.net"' <<<"$broker_policy"
sandbox_policy="$(awk 'BEGIN { RS="---" } /name: fixture-sandbox-egress/ { print }' <<<"$github")"
if rg -q 'codeload.github.com|githubusercontent.com|blob.core.windows.net' <<<"$sandbox_policy"; then
  echo 'Managed download domain unexpectedly granted sandbox egress' >&2
  exit 1
fi
if rg -q -- '--github-download-hosts=' <<<"$github"; then
  echo 'Removed download configuration flag rendered' >&2
  exit 1
fi
for setting in 'accessBroker.github.downloadHosts=["blob.example.com"]' 'accessBroker.github.downloadHosts=[]'; do
  if helm template fixture "$chart" -f "$values" -f examples/github-broker.yaml --set-json "$setting" >/dev/null 2>&1; then
    echo 'Removed download host configuration accepted' >&2
    exit 1
  fi
done
for domain in codeload.github.com objects.githubusercontent.com OBJECTS.GITHUBUSERCONTENT.COM productionresultssa19.blob.core.windows.net productionresultssa98.blob.core.windows.net '*.githubusercontent.com' '*.github.com'; do
  for provider in cilium external; do
    if helm template fixture "$chart" -f "$values" -f examples/github-broker.yaml --set "networkPolicy.toolDomains[0]=$domain" --set "accessBroker.networkPolicy.provider=$provider,accessBroker.networkPolicy.externalEnforcementConfigured=true" >/dev/null 2>&1; then
      echo "Sandbox bypass of managed download domain rendered: $domain" >&2
      exit 1
    fi
  done
done
external_downloads="$(helm template fixture "$chart" -f "$values" -f examples/github-broker.yaml --set 'accessBroker.networkPolicy.provider=external,accessBroker.networkPolicy.externalEnforcementConfigured=true,networkPolicy.enabled=false')"
if rg -q 'kind: CiliumNetworkPolicy' <<<"$external_downloads"; then
  echo 'External enforcement mode unexpectedly emits Cilium policies' >&2
  exit 1
fi
rg -q -F "!('actions' in self) || self.actions == 'read'" charts/cody-execution/crds/accessprofiles.yaml
