# Upgrades and credential rotation

Preserve every receipt/session PVC and the installation and worker identities. Settle active work and back up storage first. Read the exact supported transition in the portal/core release metadata. Selecting a target does not apply it.

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

Use the complete reviewed values for that target, preserving configuration and credentials. Do not use blind `--reuse-values` to hide an incompatible schema. Initialization on upgrade is rejected. Helm lookup must retrieve the existing worker Secret with matching release ownership; it must never regenerate it.

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
  --namespace "$CODY_NAMESPACE" rollout restart "statefulset/${CODY_HELM_RELEASE}-agent" &&
kubectl --kubeconfig "$CODY_KUBECONFIG" --context "$CODY_KUBE_CONTEXT" \
  --namespace "$CODY_NAMESPACE" rollout status "statefulset/${CODY_HELM_RELEASE}-agent" --timeout=300s
```

Execution reads its installation token at startup, so the explicit restart above is required. Stop if any step fails. Confirm a fresh connection/readiness report from the restarted executor and a successful test before explicitly revoking the old fingerprint. Retain the overlay as the current private input for future upgrades. At most two keys remain active; a lost issuance response cannot recover plaintext and must be handled explicitly in settings.

For existing-Secret mode, update only the customer-owned installation Secret using your secret manager/file input. Then use the same explicit rollout restart/status sequence and verify fresh connectivity before revoking the predecessor. Do not switch to inline mode or rotate the worker/Attach Secret. Reinstalling with lost Helm metadata, retained claims or a missing worker Secret requires explicit diagnosis, not adoption or fresh initialization. Helm uninstall leaves StatefulSet-generated PVCs, but do not rely on uninstall as a migration procedure.
