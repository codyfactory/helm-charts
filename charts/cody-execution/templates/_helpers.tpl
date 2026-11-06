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

{{- define "cody.runtimeSecret" -}}
{{- if .Values.runtimeTokenSecret -}}
{{- .Values.runtimeTokenSecret -}}
{{- else -}}
{{- printf "%s-runtime-auth" .Release.Name -}}
{{- end -}}
{{- end -}}
