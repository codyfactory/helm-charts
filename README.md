# Cody execution Helm charts

This is the canonical public chart source for Cody's customer execution plane. Cody hosts coordination and inference; customers install execution in their own Kubernetes cluster. No Cody laptop CLI, Apple account, package repository or GitHub Actions is needed.

The initial source PR is a **release candidate**. `index.yaml` intentionally contains no releases until a maintainer publishes real public image digests and the matching chart package. Do not treat synthetic example digests or core test packages as published artifacts.

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
export CODY_CHART_VERSION=0.5.0
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

After merge, checkout/pull main and create the immutable `cody-execution-<version>` tag on the publication commit. Preserve all old packages/index entries. Verify anonymous acquisition with an empty Helm repository config before adding the supported release descriptor to core. The descriptor records package URL, byte size, SHA256, core commit, image digests, protocol, chart/runtime versions and explicitly tested transitions. Do not infer runtime version from chart version. Do not activate a descriptor for this empty candidate index.

Only chart sources, generic CRDs, packages/index and public docs belong here. No credentials, kubeconfigs, private values, company tooling or application source.

### Access broker (implementation contract)

`accessBroker.enabled` deploys the portable Kubernetes proxy; `accessBroker.azure.enabled` independently opts into the Azure issuer and defaults to false. Both default off until the matching execution image supports the broker contract. `examples/broker.yaml` illustrates a Kubernetes-only installation with explicit Agent and service-account UIDs. Those values are placeholders, not an approved identity mapping. The same mapping generates the broker config and namespace-scoped RBAC. The execution controller requires `create tokenreviews` to authenticate the separate broker feed. Each enabled broker also requires `create tokenreviews` to authenticate sandbox projections. The controller receives neither impersonation nor service-account TokenRequest rights.

Provision `tlsSecret` with a certificate valid for both enabled broker Service names, `feedTLSSecret` for the broker-feed Service, and `caSecret` with `ca.crt` trusting those certificates. The chart does not generate credentials. A dedicated `<release>-sandbox` service account has automatic token mounting disabled and no RBAC grants. The execution controller projects a Pod-bound token with audience `cody-access-broker` and requested lifetime 600 seconds into the trusted runtime, outside the harness identity. Each broker request performs TokenReview with the exact audience, allowed sandbox service-account username and leased Pod UID. The runtime adds this credential to fixed broker requests over server-authenticated TLS; the harness receives only the turn token and loopback endpoints. Existing authoritative Pod/service-account reads and watches remain required. No client-signing CA or per-Pod identity Secret is used.

Select `accessBroker.networkPolicy.provider=cilium` with `networkPolicy.enabled=true` for chart-owned Cilium rules. For another CNI, `provider=external` requires `externalEnforcementConfigured=true`: the installation owner must first provide equivalent sandbox egress denial, DNS/resource allowlisting, source preservation or cryptographic binding, and broker-feed isolation. This declaration is an installation prerequisite, not evidence that the CNI enforces it. Do not enable the broker or claim support until the installation's denial and replay tests pass. The chart's standard NetworkPolicy restricts feed ingress to broker-labeled pods; existing policies must not grant additional access because Kubernetes policy rules are additive.

Broker pods specify no fixed UID or fsGroup and use non-root, restricted capabilities and read-only filesystems for OpenShift compatibility. This does not validate the rest of the execution installation on OpenShift. kind/AKS, EKS and OpenShift acceptance evidence remains separate; these templates do not claim deployed compatibility. Azure federation is optional and is not an AKS requirement. Disabling/removing a broker component does not release its outstanding lease fences: the execution plane waits for acknowledgement or lease expiry plus skew even after the Pod object is deleted.

The Kubernetes broker accepts only GET/HEAD requests in this slice and denies Secret reads in the sandbox namespace (including cluster-wide Secret enumeration). These restrictions prevent an Agent from retrieving runtime keys directly or by creating a workload to mount them; write approval remains outside this slice. TokenReview is performed for every request without caching; API-server availability and load are part of the deployment requirements.
