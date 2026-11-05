{{- define "cody.installationSecret" -}}
{{- if and .Values.installationToken .Values.installationTokenSecret -}}
{{- fail "Use installationToken or installationTokenSecret, not both" -}}
{{- end -}}
{{- if .Values.installationTokenSecret -}}
{{- .Values.installationTokenSecret -}}
{{- else -}}
{{- $_ := required "installationToken or installationTokenSecret is required" .Values.installationToken -}}
{{- printf "%s-installation-token" .Release.Name -}}
{{- end -}}
{{- end -}}

{{- define "cody.workerSecret" -}}
{{- if .Values.workerTokenSecret -}}
{{- .Values.workerTokenSecret -}}
{{- else -}}
{{- printf "%s-worker-auth" .Release.Name -}}
{{- end -}}
{{- end -}}
