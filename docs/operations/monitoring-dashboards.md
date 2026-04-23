# Monitoring Dashboards

The Grafana baseline for the first production candidate lives in:

- [ops/monitoring/grafana/agents-company-overview.json](../../ops/monitoring/grafana/agents-company-overview.json)

## Minimum dashboard surfaces

- control-plane availability
- GitHub App availability
- auth readiness
- accepted webhook volume
- rejected webhook volume
- operator workload counts
- cohort counts for internal alpha and controlled beta

## Launch usage

Use the dashboard pack in three places:

1. Pre-release staging validation
2. First production cutover watch window
3. Incident review when rollback is being considered

## Data sources

- Prometheus scrape for `control-plane`
- Prometheus scrape for `github-app`

The dashboard assumes the default Prometheus datasource variable
`${DS_PROMETHEUS}` and the metrics currently emitted by the two backend
services.

## Ownership

- Release owner confirms the dashboard pack matches the shipped metrics.
- On-call uses the same dashboard JSON during the first seven-day stabilization
  window.
