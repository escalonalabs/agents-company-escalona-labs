{{- define "agents-company.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "agents-company.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "agents-company.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "agents-company.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "agents-company.labels" -}}
helm.sh/chart: {{ include "agents-company.chart" . }}
app.kubernetes.io/name: {{ include "agents-company.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "agents-company.selectorLabels" -}}
app.kubernetes.io/name: {{ include "agents-company.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "agents-company.controlPlaneName" -}}
{{- printf "%s-control-plane" (include "agents-company.fullname" .) -}}
{{- end -}}

{{- define "agents-company.githubAppName" -}}
{{- printf "%s-github-app" (include "agents-company.fullname" .) -}}
{{- end -}}

{{- define "agents-company.controlWebName" -}}
{{- printf "%s-control-web" (include "agents-company.fullname" .) -}}
{{- end -}}

{{- define "agents-company.runtimeSecretName" -}}
{{- printf "%s-runtime" (include "agents-company.fullname" .) -}}
{{- end -}}

{{- define "agents-company.runtimeSecretRefName" -}}
{{- if .Values.runtimeSecret.existingSecretName -}}
{{- .Values.runtimeSecret.existingSecretName -}}
{{- else -}}
{{- include "agents-company.runtimeSecretName" . -}}
{{- end -}}
{{- end -}}

{{- define "agents-company.controlPlaneServiceAccountName" -}}
{{- if .Values.controlPlane.serviceAccount.name -}}
{{- .Values.controlPlane.serviceAccount.name -}}
{{- else -}}
{{- include "agents-company.controlPlaneName" . -}}
{{- end -}}
{{- end -}}

{{- define "agents-company.githubAppServiceAccountName" -}}
{{- if .Values.githubApp.serviceAccount.name -}}
{{- .Values.githubApp.serviceAccount.name -}}
{{- else -}}
{{- include "agents-company.githubAppName" . -}}
{{- end -}}
{{- end -}}

{{- define "agents-company.controlWebServiceAccountName" -}}
{{- if .Values.controlWeb.serviceAccount.name -}}
{{- .Values.controlWeb.serviceAccount.name -}}
{{- else -}}
{{- include "agents-company.controlWebName" . -}}
{{- end -}}
{{- end -}}
