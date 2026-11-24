# Cody control-plane chart

Chart 0.4.1 defaults to the stable 0.7.5 control-plane image. Configure existing
Secrets and the execution catalog as shown in `examples/control-plane-values.yaml`
at the repository root. Image access is separate from public chart access:

```yaml
imagePullSecrets:
  - name: ghcr-pull
```

The pull Secret must exist in the release namespace and allow access to the
selected registry. It is used by all workloads, including the migration hook.
The chart does not create credentials or expose public routes.

`migrations.databaseSecret` must contain a `url` key with a direct PostgreSQL
connection for the DDL role. The default pre-install/pre-upgrade Job uses the
same image as the workloads; Helm waits for success before updating them. Failed
Jobs are retained until the next attempt. Successful Jobs are cleaned up.
Precreate all Secrets, and set the Helm timeout above the migration deadline.

For first relocation, stop old writers before starting replacement processes;
this chart does not transfer data or coordinate two installations. Subsequent
upgrade migrations must be compatible with workloads still running the previous
image. Reverting a release does not roll back the database schema. See the root
README for publication and migration lifecycle details.
