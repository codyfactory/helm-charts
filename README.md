# Cody execution Helm charts

This is the canonical public chart source for Cody's customer execution plane. Cody hosts coordination and inference; customers install execution in their own Kubernetes cluster. No Cody laptop CLI, Apple account, package repository or GitHub Actions is needed.

Chart `0.5.0` is published on `main` under the immutable `cody-execution-0.5.0` tag. This branch contains the `0.6.0` **source candidate**, which adds AccessProfile configuration and is not a published release. Do not treat synthetic example digests or core test packages as published artifacts.

## Install

Use an existing Linux amd64/arm64 Kubernetes cluster with persistent storage, Helm 4.3.1 and kubectl 1.37.2. In [Cody](https://app.cody.so), create an organization and installation, request inference approval and authorize/download that installation's private values. Keep the downloaded file private; it contains a long-lived installation key. Helm retains inline values in its release records.

```sh
helm repo add cody https://raw.githubusercontent.com/codyfactory/helm-charts/main
helm repo update
chmod 600 ./cody-values.yaml

# Replace these with the exact portal registration and chosen cluster.
export CODY_KUBECONFIG=/ABSOLUTE/PATH/TO/kubeconfig
export CODY_KUBE_CONTEXT=YOUR_CONTEXT
export CODY_NAMESPACE=YOUR_REGISTERED_NAMESPACE
export CODY_HELM_RELEASE=YOUR_REGISTERED_RELEASE
export CODY_CHART_VERSION=YOUR_PORTAL_CHART_VERSION

helm install "$CODY_HELM_RELEASE" cody/cody-execution \
  --version "$CODY_CHART_VERSION" \
  --kubeconfig "$CODY_KUBECONFIG" --kube-context "$CODY_KUBE_CONTEXT" \
  --namespace "$CODY_NAMESPACE" --create-namespace \
  --values ./cody-values.yaml --timeout 5m

kubectl --kubeconfig "$CODY_KUBECONFIG" --context "$CODY_KUBE_CONTEXT" \
  --namespace "$CODY_NAMESPACE" rollout status \
  "statefulset/${CODY_HELM_RELEASE}-execution-plane" --timeout=300s
```

**Fresh install omits `--wait` and `--atomic`.** Receipt initialization is a post-install hook; waiting for the uninitialized controller first would block that hook. The hook itself waits for completion. Return to the portal for actual readiness and the native first test. Inference requires separate Cody operator approval.

The namespace must have no retained PVCs when fresh initialization is requested. Helm needs permission to list PVCs and read Secrets; failed inventory is a refusal. A failed release is not a fresh namespace. Never delete/reinitialize receipt or Sandbox volumes to retry. Inspect Helm/Kubernetes status and diagnose explicitly.

## Credentials and ownership

- `installationToken` creates a Helm-owned `<release>-installation-token` Secret. Use **either** that inline value **or** `installationTokenSecret`, never both.
- An empty `runtimeTokenSecret` generates a local runtime/Attach key once in `<release>-runtime-auth`. Upgrades use Helm's live `lookup` and require that exact release-owned Secret and valid token. A missing or foreign Secret is an error, never a key-rotation fallback.
- For customer secret managers/GitOps, use `installationTokenSecret` and `runtimeTokenSecret`; see [existing-Secret values](examples/existing-secrets.yaml). Do not put plaintext in Git. Both Secrets need a `token` key. External runtime keys must be stable and shared by the execution plane and runtime.
- Offline `helm template` cannot reuse generated live runtime-token bytes. GitOps/offline rendering therefore requires external Secrets and already initialized storage (`receipts.initializeOnInstall: false`). Initial storage administration remains explicit.
- `onboarding.enabled` optionally creates Helm-owned `cody-onboarding-codex` Agent and `cody-onboarding` Workflow. They bind only `operator/onboarding/<installation>`. Normal Helm upgrades apply the customer's chosen values to them. Do not independently adopt same-named resources.
- Chart installation does not call a model, provision a cluster or grant inference approval.

See [UPGRADE.md](UPGRADE.md) for rotation, CRDs and preservation rules.

## Agent assets and controller access

Authentication is selected on each Agent skill/reference entry. Omit `auth` for
anonymous access, or select exactly one of `public: {}`, `secretRef: {name: ...}`,
`githubApp: {}` (or an explicit `connectorRef`), and `acrWorkloadIdentity: {}`.
GitHub App access requires the hosted tenant connector; it is separate from an
Agent's runtime/tool credentials. There are no global `sandbox.assetGitSecret`,
`sandbox.assetPullSecret` or source-to-Agent Helm mappings.

A referenced Secret must be in the Agent's namespace. Git Secrets contain
`config.json` with a `hosts` map: HTTPS uses `username`/`password`; SSH uses
`username`/`privateKey`/verified `knownHosts`. OCI Secrets use type
`kubernetes.io/dockerconfigjson` and key `.dockerconfigjson`. Supply real values
through your secret manager. The execution controller reads these Secrets; they
are not mounted into Agent or asset-init containers. Agent-write RBAC must be
restricted to people permitted to use the referenced credentials/connectors.

For ACR federation, configure both `assetAccess.azure.tenantID` and
`assetAccess.azure.clientID` and provision the matching Azure federated identity
for this namespace's `<release>-execution-plane` service account. Its audience
is `api://AzureADTokenExchange`; grant the identity the required repository pull
access. The chart projects the federation token only into the controller.
Missing/incomplete identity configuration fails; there is no anonymous fallback.

Asset versions prepare in the background; admission uses a complete ready
selection and checks current authorization. Agent status reports preparation
state. The separate `assetValidation.size` emptyDir defaults to `2Gi`; it does
not share receipt storage. `sandbox.storageClass` selects storage for newly
created Sandbox PVCs; an empty value uses the cluster's default StorageClass.

## Local verification

```sh
mise install
mise exec -- helm lint --strict charts/cody-execution --values examples/lint-values.yaml
mise exec -- bash tests/templates.sh
```

The example digests and token are synthetic lint fixtures. Real controller/native/storage acceptance runs in the core Cody repo against the exact checksum-verified package exported from this source. Source editing happens here; core stores only a test package, not an editable second chart.

## Manual publication

No Actions or Pages deployment is required. Authenticate Git through your usual GitHub credentials. Never overwrite any published version, tag or package. First build/push public execution/general/SRE images from the same clean core commit and verify anonymous amd64/arm64 pulls, following the core [rollout guide](https://github.com/codyfactory/cody/blob/codex/saas-onboarding-v2-spec/deploy/fly/SAAS-HELM.md).

The `0.6.0` source candidate retains the published `0.5.0` image defaults until publication. Re-pin compatible execution and runtime images before publishing: the broker now receives `--transport-mode` and `--kube-api-qps`, which the `0.5.0` execution image does not support.

Set a **new unused version** in `charts/cody-execution/Chart.yaml`. Pin `values.yaml`'s `image` and `onboarding.image` to the real public execution and general-runtime digests. Validate with actual production values (never commit private values). Then:

```sh
export CODY_CHART_VERSION=0.6.0
export CODY_CORE_COMMIT=EXACT_40_CHARACTER_CORE_COMMIT
export CODY_SRE_IMAGE=ghcr.io/codyfactory/cody-runtime-sre@sha256:REAL_DIGEST

test ! -e "cody-execution-${CODY_CHART_VERSION}.tgz"
git diff --check
mise exec -- helm lint --strict charts/cody-execution --values examples/lint-values.yaml
mise exec -- bash tests/templates.sh
mise exec -- helm package charts/cody-execution --destination .
mise exec -- helm repo index . \
  --url https://raw.githubusercontent.com/codyfactory/helm-charts/main \
  --merge index.yaml
shasum -a 256 "cody-execution-${CODY_CHART_VERSION}.tgz"

git add charts/cody-execution index.yaml "cody-execution-${CODY_CHART_VERSION}.tgz"
git commit -m "Publish Cody execution chart ${CODY_CHART_VERSION}"
git push origin HEAD
# Merge that publication PR before tagging its exact main commit.
```

After merge, checkout/pull main and create the immutable `cody-execution-<version>` tag on the publication commit. Preserve all old packages/index entries. Verify anonymous acquisition with an empty Helm repository config before adding the supported release descriptor to core. The descriptor records package URL, byte size, SHA256, core commit, image digests, protocol, chart/runtime versions and explicitly tested transitions. Do not infer runtime version from chart version. Do not activate a descriptor for the `0.6.0` source candidate before its package and images are published.

Only chart sources, generic CRDs, packages/index and public docs belong here. No credentials, kubeconfigs, private values, company tooling or application source.

### Access broker

`accessBroker.enabled` deploys the portable Kubernetes proxy; `accessBroker.azure.enabled` independently opts into the Azure issuer and defaults to false. Use matching execution, runtime and chart revisions. On upgrades, apply the updated CRDs from `charts/cody-execution/crds/` before updating Agents or creating AccessProfiles; Helm does not upgrade existing CRDs from the chart’s `crds/` directory. The brokers default to two replicas per enabled component. Merge does not deploy or grant access.

Each Agent may reference one namespaced `AccessProfile`. Platform administrators manage the profile, Agent reference and all selected-identity grants through GitOps. Cody resolves object UIDs internally; Helm no longer accepts `accessBroker.identities`. A profile and its selected ServiceAccount must be in the Agent's namespace. A ServiceAccount can receive resource RoleBindings in other namespaces without a cross-namespace profile reference.

```yaml
apiVersion: execution.cody.so/v1alpha1
kind: AccessProfile
metadata:
  name: sre-reader
  namespace: default
spec:
  kubernetes:
    serviceAccountRef:
      name: sre-reader
  # Optional; enable accessBroker.azure.enabled separately:
  # azure:
  #   tenantID: "<tenant-id>"
  #   clientID: "<client-id>"
  #   allowedResources: [https://management.core.windows.net/, https://management.azure.com]
```

Add `accessProfileRef: {name: sre-reader}` to the existing Agent's `spec`. Profile readiness reports whether configuration and the selected ServiceAccount resolve; it does not prove Azure federation or resource permissions. Access-affecting profile changes revoke frozen access according to the execution controller's observation/renewal behavior; metadata changes do not switch the identity of an active turn. Previously issued Azure tokens retain their provider expiry.

[`examples/access-profile.yaml`](examples/access-profile.yaml) includes the profile and explicit scoped RBAC for release `cody` in namespace `default`: selected ServiceAccount resource reads and a named Kubernetes broker impersonation grant. [`examples/access-profile-azure-rbac.yaml`](examples/access-profile-azure-rbac.yaml) adds the optional Azure issuer's named ServiceAccount TokenRequest grant. Change release/namespace names together before applying. Azure federation and Azure resource roles must be configured separately. The chart never generates selected-ServiceAccount impersonation, TokenRequest or workload resource grants. It supplies only the runtime's system permissions, including TokenReview, Pod observation, namespace-wide ServiceAccount metadata reads (`get` for the controller, `get`/`watch` for brokers), and controller profile reads/status updates. An Agent reference alone cannot grant additional Kubernetes permissions.

#### Transport

Choose a transport explicitly when opting out of application TLS:

```yaml
accessBroker:
  enabled: true
  transport:
    mode: mesh  # tls (default), mesh, or plaintext
  networkPolicy:
    provider: external
    externalEnforcementConfigured: true
```

`mesh` and `plaintext` serve HTTP without Cody certificate Secrets. Mesh mode is a declaration that the installation owner supplies proxy injection, mutual TLS and peer policy; the chart does not install or verify a mesh. Plaintext is an explicit opt-out from transport encryption, so credentials are exposed to any party able to intercept the network path. Authentication, Pod binding and lease fencing remain enabled in all modes. Missing TLS credentials never cause automatic downgrade.

For company-provided TLS:

```yaml
accessBroker:
  enabled: true
  transport:
    mode: tls
  tlsSecret: broker-server-tls
  feedTLSSecret: broker-feed-tls
  caSecret: broker-ca
```

Provide `tlsSecret` with `tls.crt`/`tls.key` valid for `<release>-broker-kubernetes.<namespace>.svc.cluster.local` and, if enabled, `<release>-broker-azure.<namespace>.svc.cluster.local`. `feedTLSSecret` covers `<release>-broker-feed.<namespace>.svc.cluster.local`. The CA Secret contains `ca.crt` trusting both servers at these internal Service DNS names. Per-leg overrides are available under `accessBroker.transport.sandboxToBroker.mode` and `.brokerToFeed.mode`. Configure certificates only for TLS legs.

Alternatively, if cert-manager is already installed, set `accessBroker.issuerRef: {name: platform-internal, kind: ClusterIssuer}` instead of `tlsSecret` and `feedTLSSecret`. The chart creates Certificates for the enabled TLS legs. The issuer must support the internal Service DNS names. `issuerRef` requires `caSecret` and fails at render time when it is missing; the chart does not infer CA trust from an issuer. Do not configure managed and existing TLS Secrets together. Roll the corresponding broker/controller workloads after certificate renewal so the listeners load the new key pair.

#### Sandbox and network setup

The chart creates a dedicated `<release>-sandbox` ServiceAccount with automatic token mounting disabled and no RBAC grants. The controller projects a Pod-bound token with audience `cody-sandbox-access` and requested lifetime 600 seconds into the trusted runtime, outside the harness identity. Broker-feed tokens use the separate configured audience (`cody-access-broker` by default). Every broker request performs TokenReview for the exact audience, allowed sandbox ServiceAccount and leased Pod UID. The runtime supplies kubeconfig and optional Azure CLI environment automatically. No client-signing CA, per-Pod identity Secret, manually entered UIDs or privileged sandbox ServiceAccount is required.

Select `accessBroker.networkPolicy.provider=cilium` with `networkPolicy.enabled=true` for chart-owned Cilium rules. For another CNI, `provider=external` requires `externalEnforcementConfigured=true`: the installation owner must first provide equivalent sandbox egress denial, DNS/resource allowlisting and broker-feed isolation. This declaration is a prerequisite, not evidence that the CNI enforces it. Existing NetworkPolicies must not grant bypass access because Kubernetes policy rules are additive. Apply the same checks when using a mesh.

The Kubernetes broker accepts only GET/HEAD requests and denies Secret reads in the sandbox namespace, including cluster-wide Secret enumeration. Write approval remains outside this slice. Authoritative Pod/ServiceAccount watches and periodic reads remain required. A feed interruption retains cached lease authorization only until its execution deadline; identity failures still deny access, and successors remain fenced until acknowledgement or expiry plus skew. Disabling or deleting a broker Deployment does not remove its outstanding fencing obligations.

Broker pods use non-root, restricted capabilities and read-only filesystems without fixed UID/fsGroup. This does not validate the whole installation on OpenShift: sandbox runtime requirements and CNI behavior still need acceptance. Projected-token deployment, mesh enforcement and plaintext deployment acceptance remain unverified. Use a controlled Agent turn to test allowed reads, denied operations, identity changes, lease expiry and feed outages before enabling shared workloads.

## GitHub broker

Enable `accessBroker.github.enabled` with the controller/runtime revision that adds
GitHub broker support. `examples/github-broker.yaml` shows the Cilium network and
TLS settings. `upstreamHosts` is an installation network allowlist populated from
the connector's trusted Git/API hosts; it grants no repository permissions. Keep
it synchronized with connector configuration. These hosts must not appear in
sandbox `networkPolicy.toolDomains`. External enforcement must supply equivalent
sandbox denial, broker-only feed access and restricted broker upstream egress.
On AKS, FQDN filtering requires Azure CNI Powered by Cilium and Advanced Container
Networking Services (ACNS); rendered manifests alone do not prove enforcement.

`examples/github-profile.yaml` provides reader and contributor AccessProfiles.
The capabilities are `contents` and `pull_requests`, each `read` or `write`,
and `actions: read`. Actions write is unsupported and reviews receive no implicit
Actions permission.
GitHub-only profiles need no selected Kubernetes ServiceAccount. Azure still
requires its Kubernetes identity. Writes use standing administrator grants and
retain GitHub's native scope: apply branch protections/rulesets and inspect App
bypass settings when direct pushes or merges should be restricted. The broker
does not prompt for per-write approval or automatically approve pull requests.
GitHub installation tokens implicitly include repository metadata access. GitHub
may also expose public resources outside the selected repository IDs; the broker
retains that provider permission behavior. It separately denies credential-management
API endpoints so a caller cannot revoke a shared installation token.
Git requests check frozen repository IDs immediately before forwarding. GitHub
uses mutable repository paths, so a concurrent rename/slug-reuse race between
that check and the Git operation remains an accepted limitation; exact-scoped
tokens and per-request identity checks still apply.

Git smart HTTP remains streamed. Metadata API responses must be JSON
(`application/json` or `application/*+json`), at most 8 MiB and 64 levels deep.
The broker requests identity encoding, buffers the response before forwarding,
and recursively removes `temp_clone_token` and `download_url`. It removes API
`Location` headers and invalidated validators/digests from rewritten bodies.
Empty responses, HEAD and 204 remain supported. Selected GET operations stream
repository zip/tar archives, Actions run/job logs, Actions artifact zip downloads,
and release assets requested as `application/octet-stream`. The broker follows at
most five redirects under the same live lease and strips authentication from
redirected blob requests. It exposes neither signed redirect URLs nor download
credentials to the sandbox. Other raw/diff/binary metadata modes remain unsupported.
API request bodies remain unchanged and are not parsed into a second permission
matrix. Include these response limits in native-client acceptance after upgrades.

Configure `accessBroker.github.downloadHosts` with the exact DNS names used by
these downloads. Its default `[]` disables external redirect following. The same
normalized list becomes `--github-download-hosts` and broker-only DNS/FQDN/SNI
Cilium egress rules. Names are case-insensitive; duplicate names, IP addresses,
ports, URLs and wildcards are rejected. Do not add these hosts to sandbox
`networkPolicy.toolDomains`. With external enforcement, configure equivalent
broker-only HTTPS egress to the exact download hosts and retain sandbox denial
before setting `externalEnforcementConfigured`. The list is an operator network
allowance, not a repository grant; the initiating API request still uses the
lease's scoped token. Restrict the list to the provider's actual download hosts.

Reviews require the broker too. Without a selected AccessProfile, an authorized
review lease grants repository-wide contents reads to both checkout preparation
and the harness. A selected profile replaces that default entirely; it must
include the review repository and contents read/write. Invalid or disjoint
profiles never fall back. Review publication remains pinned to its original head.

Provider tokens remain outside sandbox processes and may be shared across leases
with identical scopes. Each request still requires its own live lease and Pod
identity. Ending one lease does not revoke another lease's shared provider token.
Runtime images package `gh`; native clients receive a non-secret placeholder and
a runtime-owned public trust bundle, without changing the system trust store.

Roll out the matched controller, broker, runtime images and this chart together.
Do not enable GitHub-backed Agents/reviews until connector permissions, effective
CNI isolation and both supported harnesses have passed acceptance. Disable new
work and drain active leases before rolling back to revisions using direct review
checkout; never add a sandbox GitHub egress exception to repair a mixed rollout.

Local rendering and native-client fixtures do not establish live GitHub App,
branch-protection, model-harness or AKS Cilium/ACNS acceptance. Verify those in the
installation before treating the deployment as ready.
