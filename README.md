# Cody execution Helm charts

This is the canonical public chart source for Cody's customer execution plane. Cody hosts coordination and inference; customers install execution in their own Kubernetes cluster. No Cody laptop CLI, Apple account, package repository or GitHub Actions is needed.

Chart `0.6.3` is available from the public Helm index alongside `0.5.0`. It adds AccessProfile configuration and Sandbox placement and storage defaults.

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

After merge, checkout/pull main and create the immutable `cody-execution-<version>` tag on the publication commit. Preserve all old packages/index entries. Verify anonymous acquisition with an empty Helm repository config before adding the supported release descriptor to core. The descriptor records package URL, byte size, SHA256, core commit, image digests, protocol, chart/runtime versions and explicitly tested transitions. Do not infer runtime version from chart version. Activate a descriptor after its package and images are published.

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
credentials to the sandbox. Actual plain-text and GitHub diff/patch/raw media responses stream too, as does
HTML from the Markdown rendering endpoints. Negotiated raw contents/blob GETs
support binary bodies and managed download redirects. This includes
`application/vnd.github.raw+json; charset=utf-8`, which contains raw file bytes
despite its suffix. Ordinary JSON metadata, including directory listings returned
as `application/json`, remains bounded and sanitized; other
binary modes remain limited to the supported download operations.
API request bodies remain unchanged and are not parsed into a second permission
matrix. Include these response limits in native-client acceptance after upgrades.

Cody owns the supported public-GitHub download domains: `codeload.github.com`,
`*.githubusercontent.com` and `*.blob.core.windows.net`. No operator hostname
setting or download-host flag is supported. The broker and chart ship this policy
together; rotating Azure storage accounts need no per-account configuration.
Each `*.` matches one DNS label, not the domain itself or nested subdomains.
The chart uses DNS/FQDN `matchPattern` and TLS `serverNames` for these patterns,
consistent with [Cilium's DNS matching](https://docs.cilium.io/en/stable/security/policy/layer3/#dns-based)
and [SNI pattern semantics](https://github.com/cilium/cilium/blob/main/pkg/policy/api/l4.go).
Use a Cilium version with that SNI pattern support; rendering is not live enforcement proof.

Azure Blob Storage is shared infrastructure, not a GitHub-owned domain. Cody
follows only backend redirects from supported, authenticated GitHub API GETs,
without provider credentials on blob hops. These domains are broker-only network
allowances, never sandbox egress grants. Sandbox tool-domain overlap is rejected.
External enforcement must supply equivalent broker-only HTTPS policy and retain
sandbox denial before setting `externalEnforcementConfigured`. Existing connector
`upstreamHosts` configuration is unchanged. Additional enterprise download
backends require Cody policy support; there is no ad hoc hostname override.

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

### Optional broker network enforcement

On Calico or another cluster without Cilium, explicitly set `accessBroker.networkPolicy.provider: none` and `networkPolicy.enabled: false` to run the broker without chart-enforced egress containment. Credential authorization and tenant checks remain enabled. This mode does not prevent sandbox bypass of the broker through other network paths. Defaults still require an enforcement choice; `external` continues to require confirmation of external enforcement. This unenforced mode is rejected when the tools broker is enabled: anonymous MCP endpoints require network isolation to prevent sandbox bypass.

Agent `agentsMD` accepts up to 65,536 characters. Skill names may contain colon-separated namespace segments, for example `alpheya:create-pr`; reference-input names retain their existing syntax.

## Package registry broker

The package-registry source candidate adds `accessBroker.packages.enabled` and
`AccessProfile.spec.packageRegistries`. Deploy matching controller, broker and
runtime images before enabling it. Apply the updated CRD first. The chart does
not install package-manager binaries into Agent images or provision upstream
credentials.

`examples/packages-broker.yaml` configures the dedicated broker and its Cilium
network policy. `upstreamHosts` is the installation firewall allowlist; profile
endpoint roots independently authorize each lease. Include every configured
registry/download host in that firewall list. GitHub Packages automatically adds
`pkg-npm.githubusercontent.com` as a redirect-only download host; operators do
not need to add it as an endpoint or firewall entry. The sandbox must not have direct
egress to these hosts; the chart rejects overlapping `networkPolicy.toolDomains`
when enforcement is enabled. External policies must provide equivalent isolation.

`examples/packages-profile.yaml` shows two registries with different credentials.
Each entry contains a unique `name`, nonoverlapping HTTPS `endpoints`, and exactly
one of `auth.bearer.secretRef: {name, key}` or
`auth.basic: {secretRef: {name}, usernameKey, passwordKey}`. All Secret references
resolve in the Agent namespace. Basic Secret values are the raw username and
password/PAT, not an already encoded Authorization header. Provision Secrets
separately through the operator's normal secret-management mechanism. Only the
controller reads them; package broker Pods receive neither Secret mounts nor
Secret-read RBAC.

The initial transport is download-only (GET/HEAD). It preserves original registry
URLs and lockfiles, including scoped package paths. Credentialed roots belong in
`endpoints`; custom credential-free CDN hosts belong in `downloadHosts` and the
installation firewall list. Download hosts are reachable only through redirects,
never directly through the sandbox forwarder. Redirects must stay within the
selected grant's endpoints or download hosts; credentials are stripped on crossing
origins and never restored later in that chain. Package publishing, automatic OAuth login and arbitrary CDN destinations
are unsupported. Add only verified endpoint roots; granting a hostname does not
restrict individual packages under that root. Upstream credential permissions
remain the package authorization boundary. Registry Secrets are reserved from
Agent `credentialRef`, including across Agents. Missing authentication keys mark
the profile unavailable.

The broker coalesces credential acquisition and caches it per lease and frozen
registry grant for up to 30 seconds, bounded by lease expiry. Same-UID Secret data
rotation becomes visible on the next acquisition; lease and Pod authorization
still run for every request. Native clients receive a non-secret
`NODE_AUTH_TOKEN` placeholder for existing `.npmrc` interpolation.

Private Go modules fetched from GitHub use the existing GitHub repository grant,
not a package-registry PAT. Grant every private dependency repository, configure
`GOPRIVATE` and related private-resolution settings, and supply the required Go
compiler and public dependency connectivity. A private Go module proxy is a
separate HTTP registry use case. Native-client fixture results are recorded in
the code repository; chart rendering alone does not establish live acceptance
for GitHub Packages, GitLab, npm or Azure Artifacts.

### MCP toolboxes

Enable the tools broker using [tools-broker.yaml](examples/tools-broker.yaml). Add the connection, frozen selector and availability policy inline in an Agent's selected AccessProfile, as in [tools-profile.yaml](examples/tools-profile.yaml). Secret data keys are header names and values are their values; provision these Secrets separately. Only the execution controller reads them. The dedicated tools broker receives credentials over the authenticated lease RPC and has no upstream Secret volume or Secret-read RBAC.

Enabling the tools broker requires explicit `accessBroker.tools.resources.requests` and `limits`, each with CPU and memory quantities. Disabled tools default to an empty resource object; enabling them without bounds fails chart validation. The example uses requests of 100m CPU/128Mi and limits of 1 CPU/512Mi to demonstrate the configuration, not a validated fleet capacity. Size these per replica against concurrent sessions, catalog sizes and measured memory/CPU; resource limits do not replace application concurrency limits.

`accessBroker.tools.maxScopes` defaults to 128 per broker process; `maxScopesPerLease` defaults to 64 and must not exceed it. A scope is a lease/pod/profile/toolbox connection, including pending setup and bounded cleanup, retained until its lease or upstream connection ends. These defaults let one lease occupy at most half of one replica's scope capacity; they are not a fleet fairness guarantee. ClientIP affinity can concentrate traffic on one replica. Tune both limits and CPU/memory resources from installation inventory and measured load. Exhaustion returns HTTP 429, audits a safe capacity class plus limit/usage and never becomes an authorization denial. A required toolbox failing setup on overload intentionally prevents model startup; an optional toolbox continues with a `capacity_exhausted` availability notice. Cody does not queue or replay a tool call to hide overload.

The profile specifies what a lease may use. Helm separately specifies what the broker can reach: external destinations require a host and port; internal destinations require a DNS host, namespace, pod labels and port. Add both when onboarding a server. Prefer fully qualified Service DNS names. Internal HTTP on port 8000 or 8080 does not alter sandbox-to-broker or broker-to-feed TLS; only that profile entry opts into plaintext. Use system trust for upstream HTTPS. The tools Service uses ClientIP affinity because MCP sessions live within a broker process. A restart loses those sessions: clients must initialize a fresh session and must not replay an ambiguously dispatched tool call.

When Cilium policy is enabled, the chart restricts broker destinations and rejects toolbox hosts in sandbox `networkPolicy.toolDomains`. The Helm overlap check compares configured hostname strings after case and trailing-dot normalization. It cannot discover CNAMEs, alternate Kubernetes Service names or other DNS aliases and is not a complete bypass check. Operators must inventory those aliases and must not allowlist them for sandbox access. Default-deny and destination ingress must also cover every alias and Service/pod-IP access to anonymous servers; verify denial by each route, not only the configured hostname. NetworkPolicy allows are additive: another broad policy can undo isolation. Verify the effective policy, including other namespaces and deployments. Cilium FQDN support on AKS requires the appropriate ACNS configuration.

The tools broker rejects `provider: none`, even if the external acknowledgement is set. For Calico or another CNI, set `accessBroker.networkPolicy.provider: external` and `externalEnforcementConfigured: true` only after installing equivalent sandbox egress, broker egress and destination ingress rules. [tools-destination-ingress.yaml](examples/tools-destination-ingress.yaml) is a standard Kubernetes NetworkPolicy usable with Calico for one internal destination; adapt the release and namespace labels. It is not a complete external-host policy. Installation owners must deny sandbox direct access on every destination port/IP, allow only the dedicated broker to anonymous services, restrict broker egress to configured destinations, and verify no overlapping policy widens these rules. Disabling the chart's Cilium policy does not establish this boundary.

Roll out toolbox support in stages, with no toolbox grants during the image upgrade:

1. Apply the matching updated AccessProfile CRD using the installation's GitOps process; Helm does not upgrade existing CRDs. Keep existing profiles free of `toolboxes` and keep `accessBroker.tools.enabled: false`.
2. Upgrade the execution image (controller and every existing broker Deployment) and the sandbox runtime image to the matching toolbox-capable release. Wait until every old controller and broker replica has terminated and the replacements have synchronized their lease snapshots. Existing profiles without toolbox entries retain their resolved revision. Use a runtime with Codex 0.160.0 or newer for the thread-scoped MCP readiness contract; do not assume an old runtime becomes compatible by updating the controller alone.
3. Configure and verify Cilium or the acknowledged external isolation rules, then enable the tools broker with its matching image and destination configuration. Wait for all tools broker replicas to be ready.
4. Only then add the first `toolboxes` entries to AccessProfiles and start acceptance turns. Do not combine the first grants with the rolling image upgrade: a toolbox-bearing feed must never reach an older broker. Older brokers ignore the new protobuf field, then reject a toolbox-only grant as invalid, rejecting the shared snapshot for their mode as well.

Before rollback, stop new toolbox work, remove toolbox grants, and let their leases end or fence. Confirm that toolbox grants and their retained tombstones are absent from the published snapshots before downgrading images or the CRD; removing profile YAML alone is insufficient. Preserve receipts and existing native session storage. Published release image digests must replace source-candidate pins; this chart does not publish those images or establish deployed acceptance.

Runtime setup is bounded to four concurrent discoveries and 60 seconds overall, including session cleanup. Each endpoint gets at most 30 seconds; larger inventories divide the setup budget across the required four-wide waves, reserving ten percent for scheduling overhead so early dead endpoints cannot consume every later endpoint’s attempt. `fail` prevents model startup when a server or an explicit tool is missing. `continue` exposes the available subset and gives the model an availability notice; a wholly unavailable server is retried on a subsequent turn. Revocation always fences access regardless of this policy. Keep server-specific routing guidance in the Agent's existing versioned skills or reference inputs.

### GitHub document path selection

With an engine release supporting codyfactory/docs#68, a GitHub Workflow can
limit reviews to matching files:

```yaml
paths:
  includePatterns: [requirements/**/*.md]
  excludePatterns: [requirements/**/execution.md, requirements/post-merge.md]
  onAllExcluded: pass
```

Set this under `spec.github.paths` (or `spec.githubWorkflow.paths` for an
ID-based source). Excludes override includes; omitted includes select all
paths. Existing `excludePrefixes` remain supported and also exclude matches.
Either side of a rename can require review. Only a complete, nonempty diff
with no qualifying paths completes the named check successfully without a
harness. The engine freezes the policy at admission.

Globs match the full case-sensitive repository-relative path: `*`, `?`, and
character classes operate within segments; a `**` segment matches zero or
more directories. Embedded double stars such as `docs/**.md` are rejected;
use `docs/**/*.md` for recursive Markdown matching. Brace alternatives and backslash escapes are unsupported.
The engine rejects malformed globs before admitting work. Each list allows
32 unique patterns, each at most 256 bytes.

Install the updated Workflow CRD and upgrade both planes before configuring
patterns. Helm upgrades do not update CRDs; follow [UPGRADE.md](UPGRADE.md).
Remove pattern-based configuration and settle admitted work before rolling
back to an engine that does not understand these fields.

## Sandbox placement and local storage

Chart `0.6.3` wires installation defaults through `sandbox.nodeSelector`, `sandbox.tolerations`, and `sandbox.resources.requests.ephemeral-storage` / `sandbox.resources.limits.ephemeral-storage`. The default execution and onboarding images are pinned to verified `ghcr.io/codyfactory` digests.

An Agent's present sandbox setting replaces its installation default as a whole,
including empty maps and lists. The chart's default selector and tolerations are empty.
The 1Gi ephemeral-storage request, 2Gi limit and 1Gi workspace size are unmeasured
starting values; size them against representative workloads and measured eviction
overshoot. Reviews, finding replies and scheduled fresh occurrences use bounded
`emptyDir`; conversational work and scheduled reuse retain their PVCs. Existing
PVC size and storage class remain fixed. See the
[storage and acceptance guide](https://github.com/codyfactory/cody/blob/feat/sandbox-policy/hack/planes/SANDBOX-STORAGE.md).

## Workflow source status

The Workflow CRD retains `status.sources` and the `SourcesReady` condition reported by the execution controller. Each source reports `Accepted`, `Pending`, `ConnectorUnbound`, `PolicyDenied`, `Conflict`, or `Invalid`; conflicts can name other installations in the same organization. `status.sourcesHash` lets the controller avoid unchanged status writes. This schema requires the source-status controller implementation from codyfactory/docs#73 before these fields are populated.

Apply the updated Workflow CRD through your deployment system before updating the execution controller. Helm upgrades do not update existing CRDs automatically. Existing Workflow status patch permissions already cover this change.

GitHub Workflows may omit `spec.github.connectorRef`, just as Agent `auth.githubApp` may omit `connectorRef`. Omission selects the organization's default GitHub connection; an explicit ref selects that named connection. The control plane owns default selection and reports `ConnectorUnbound` when no connection resolves.
