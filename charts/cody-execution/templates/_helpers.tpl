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

{{- define "cody.brokerTransport" -}}
{{- default .Values.accessBroker.transport.mode .Values.accessBroker.transport.sandboxToBroker.mode -}}
{{- end -}}
{{- define "cody.feedTransport" -}}
{{- default .Values.accessBroker.transport.mode .Values.accessBroker.transport.brokerToFeed.mode -}}
{{- end -}}
{{- define "cody.brokerTLSSecret" -}}
{{- if .Values.accessBroker.issuerRef.name -}}
{{- printf "%s-broker-tls" .Release.Name -}}
{{- else -}}
{{- .Values.accessBroker.tlsSecret -}}
{{- end -}}
{{- end -}}
{{- define "cody.feedTLSSecret" -}}
{{- if .Values.accessBroker.issuerRef.name -}}
{{- printf "%s-broker-feed-tls" .Release.Name -}}
{{- else -}}
{{- .Values.accessBroker.feedTLSSecret -}}
{{- end -}}
{{- end -}}

{{- define "cody.githubDownloadDomains" -}}
{{- list "codeload.github.com" "*.githubusercontent.com" "*.blob.core.windows.net" | toJson -}}
{{- end -}}
