# Upgrades and credential rotation

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

## Breaking Sandbox/execution-plane cutover

These install/rotation instructions target installation protocol 3, runtime image
protocol 2 and receipt-journal format 5. Earlier `-agent`/`-worker` resources,
`workerTokenSecret` values, callback services and receipt layouts are incompatible.
This is not a rolling upgrade or a credential rotation.

Stop incoming work, settle or explicitly abandon outstanding turns, and stop the
old execution plane and runtime Pods. Archive the database and receipt/Sandbox
PVCs before changing either plane. The control-plane migration 039 refuses old
serialized dispatch receipts/operation results; an installation with that history
needs an explicitly provisioned fresh database. Never delete individual receipt
rows or change a version marker to bypass that refusal. The onboarding follow-up
adds index migration 040; it does not convert incompatible execution history.

Provision fresh receipt storage and matching protocol-2 runtime images. Update
Workflow Sandbox fields, CRDs, Secrets, resource references and network policies
together. Old native state/PVC layouts are not automatically migrated. Keep the
old archives until their deletion is explicitly authorized. Register the current
installation, restore reviewed configuration/grants, and verify a new Sandbox and
two consecutive turns before enabling incoming work.

Within this new protocol, ordinary credential rotation preserves the generated
runtime token and every receipt/Sandbox PVC. Use the installed compatible chart
version, disable initialization, restart `<release>-execution-plane`, confirm a
fresh authenticated report and successful test, then revoke the predecessor.
Rollback across the cutover requires matching old binaries, database backup and
receipt storage; old binaries cannot serve the new database or journal.
