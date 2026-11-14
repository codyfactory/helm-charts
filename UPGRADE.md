# Upgrades and credential rotation

This procedure applies only to compatible current-protocol installations. For an earlier execution version, follow the greenfield baseline section below before attempting an upgrade or rotation.

Preserve every receipt/Sandbox PVC and the installation and runtime-token identities. Settle active work and back up storage first. Read the exact supported transition in the portal/core release metadata. Selecting a target does not apply it.

Helm does not upgrade CRDs. Review the new CRDs and apply them explicitly before upgrading the release:

```sh
umask 077
export CODY_NEW_CHART_VERSION=YOUR_SUPPORTED_TARGET
work="$(mktemp -d)"
helm pull cody/cody-execution --version "$CODY_NEW_CHART_VERSION" --destination "$work"
tar -xzf "$work/cody-execution-${CODY_NEW_CHART_VERSION}.tgz" -C "$work"
kubectl --kubeconfig "$CODY_KUBECONFIG" --context "$CODY_KUBE_CONTEXT" \
  apply -f "$work/cody-execution/crds"
helm upgrade "$CODY_HELM_RELEASE" cody/cody-execution \
  --version "$CODY_NEW_CHART_VERSION" \
  --kubeconfig "$CODY_KUBECONFIG" --kube-context "$CODY_KUBE_CONTEXT" \
  --namespace "$CODY_NAMESPACE" --values ./cody-values.yaml \
  --set receipts.initializeOnInstall=false --wait --timeout 5m
```

Use the complete reviewed values for that target, preserving configuration and credentials. Do not use blind `--reuse-values` to hide an incompatible schema. Initialization on upgrade is rejected. Helm lookup must retrieve the existing runtime Secret with matching release ownership; it must never regenerate it.

For rotation, authorize a new key in portal installation settings and download `cody-credential-values.yaml`. It contains **only** the new installation credential. Inspect local Helm metadata first. Set `CODY_INSTALLED_CHART_VERSION` to the actual installed chart version, independently of any selected portal target or reported runtime version. The engine does not report a Helm chart version. The matching public package must remain available; if it is unavailable, diagnose rather than substituting a new target. Apply the overlay over your saved base values at that **same installed** chart version:

```sh
helm get metadata "$CODY_HELM_RELEASE" \
  --kubeconfig "$CODY_KUBECONFIG" --kube-context "$CODY_KUBE_CONTEXT" \
  --namespace "$CODY_NAMESPACE"
export CODY_INSTALLED_CHART_VERSION=VERSION_FROM_LOCAL_HELM_METADATA

chmod 600 ./cody-credential-values.yaml &&
helm upgrade "$CODY_HELM_RELEASE" cody/cody-execution \
  --version "${CODY_INSTALLED_CHART_VERSION:?Inspect and set the installed chart version first}" \
  --kubeconfig "$CODY_KUBECONFIG" --kube-context "$CODY_KUBE_CONTEXT" \
  --namespace "$CODY_NAMESPACE" \
  --values ./cody-values.yaml --values ./cody-credential-values.yaml \
  --set receipts.initializeOnInstall=false --wait --timeout 5m &&
kubectl --kubeconfig "$CODY_KUBECONFIG" --context "$CODY_KUBE_CONTEXT" \
  --namespace "$CODY_NAMESPACE" rollout restart "statefulset/${CODY_HELM_RELEASE}-execution-plane" &&
kubectl --kubeconfig "$CODY_KUBECONFIG" --context "$CODY_KUBE_CONTEXT" \
  --namespace "$CODY_NAMESPACE" rollout status "statefulset/${CODY_HELM_RELEASE}-execution-plane" --timeout=300s
```

Execution reads its installation token at startup, so the explicit restart above is required. Stop if any step fails. Confirm a fresh connection/readiness report from the restarted executor and a successful test before explicitly revoking the old fingerprint. Retain the overlay as the current private input for future upgrades. At most two keys remain active; a lost issuance response cannot recover plaintext and must be handled explicitly in settings.

For existing-Secret mode, update only the customer-owned installation Secret using your secret manager/file input. Then use the same explicit rollout restart/status sequence and verify fresh connectivity before revoking the predecessor. Do not switch to inline mode or rotate the runtime/Attach Secret. Reinstalling with lost Helm metadata, retained claims or a missing runtime Secret requires explicit diagnosis, not adoption or fresh initialization. Helm uninstall leaves StatefulSet-generated PVCs, but do not rely on uninstall as a migration procedure.

## Greenfield Sandbox baseline

The current baseline uses installation delivery protocol 3 and runtime-image
protocol 2. Core defines fresh Sandbox PostgreSQL schemas directly through 038;
the paired onboarding index is migration 039. There is no terminology-conversion
migration or numbered receipt-format migration. Fresh-only initialization checks
the current journal structure and initialization/installation markers.

Do not run these instructions against earlier `-agent`/`-worker` resources,
`workerTokenSecret` values or incompatible receipt layouts. Archive old database
and receipt/native storage before replacing an earlier development installation.
Provision an explicitly chosen fresh database and fresh receipt storage for the
current greenfield baseline; do not relabel schema markers, delete individual
receipt rows, or assume native-state migration. No automatic reset/adoption or
compatibility wrapper is provided.

Within a compatible current installation, ordinary credential rotation preserves
the generated runtime token and every receipt/Sandbox PVC. Use the installed
chart version, disable initialization, restart `<release>-execution-plane`,
confirm fresh authentication and a successful test, then revoke the predecessor.

## Organization source authorization

The candidate 0.6.4 schema accompanies [Cody #97](https://github.com/codyfactory/cody/pull/97). Apply its CRDs through GitOps before the matching controller rollout: Helm upgrades do not update existing CRDs. An older Workflow CRD silently prunes `status.sources`, `status.conditions`, and `status.sourcesHash`; readiness never appears and the controller repeatedly patches status.

Stop all old control-plane writers before starting any replacement control-plane process; do not overlap versions through a rolling update. This includes API, gateway, connectors and reconciliation roles. Migration 053 moves legacy report queues, and startup repeats the move before shared workers start to recover jobs inserted between migration and shutdown. That repair is not a compatibility service for old processes that continue enqueueing after startup.

The pre-release migrations in #97 are edited in place: 049 and 051 retain a defaults row with a nullable selected ID, and Slack OAuth recovery is migration 054. Recreate disposable databases initialized from superseded #97 candidates; this is not an incremental upgrade from those candidate schemas.

Verify the live schema before updating the controller:

```sh
kubectl get crd workflows.execution.cody.so -o jsonpath='{.spec.versions[?(@.name=="v1alpha1")].schema.openAPIV3Schema.properties.status.properties.sourcesHash.type}'
```

The result must be `string`. Use the reviewed CRD-apply procedure above when it is missing. Existing `workflows/status` permissions cover these updates.

GitHub Workflows and Agent `auth.githubApp` may omit `connectorRef`. Slack Workflows and schedule reporting use the same organization-default resolution. An explicit invalid reference fails closed. A provider-revoked default stays selected and fails closed; only an owner's audited `SetDefault` selects a different connection. Owner disconnect or operator unbind of the default clears it and leaves unqualified Workflows `ConnectorUnbound` until an owner calls `SetDefault`. Only the organization's first-ever connection for each provider becomes default automatically; later connects never restore a cleared default, even after all prior bindings were removed. Coordinate the control and execution planes; old connector flags and operator grant APIs are removed, and old grants are not copied.

Execution chart `0.6.4` pins rebuilt execution/runtime images from Cody commit `9272b0cc54df1340c87a2508d7887c3ad8872960`, build `0.6.4-9272b0cc`. This execution build keeps temporary Slack source and schedule-reporting lookup failures retryable during admission. Subscription and status synchronization still isolate failed lookups. The control-plane image retains the nullable-default build from `2126ab5d31325d140aeb84e5bda7cf24ba3ec84d` as `0.6.4-2126ab5d`, pinned by control-plane chart `0.4.0`. Both builds support Linux AMD64 and ARM64; each chart appVersion identifies its corresponding image build. The chart package/index is published separately after the source PR merges.

| Image | Immutable reference |
| --- | --- |
| execution | `ghcr.io/codyfactory/cody-execution@sha256:810051eeaa4dbfce6f505579effaa9f2fab568c818ead331496a4d4fd0bdc03d` |
| general | `ghcr.io/codyfactory/cody-runtime-general@sha256:5833e510c64e0d9aeb99c718a16d9102509448ec9cc8a337d0d8bb12a671065c` |
| sre | `ghcr.io/codyfactory/cody-runtime-sre@sha256:b584cc7d73c2d96d437e79be5011f360eceedac12dba73b200ff107d106057ef` |
| control-plane | `ghcr.io/codyfactory/cody-control-plane@sha256:4c9c432011baa80712a8245a68c6548c4c14d1edee9171377c6c275c377ade11` |

Execution, general and SRE images are public. The control-plane image remains private; control-plane chart `0.4.0` accepts existing registry credentials through `imagePullSecrets`. Coordinate both planes for this breaking cutover. No deployment is performed by publishing these images.
