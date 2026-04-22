# GitHub-Linked Progress And Drift Alerts

## Purpose

Define the progress views and alerts that relate runtime truth to GitHub projections.

## Required progress views

- runtime objective progress
- work-item status versus GitHub issue status
- open drift by severity
- last successful projection time

## Alert classes

- projection lag warning
- delivery failure warning
- protected-field drift alert
- missing GitHub object alert
- repeated reconciliation conflict alert

## Alert rule

Every alert must answer:

- what diverged
- which aggregate is affected
- whether runtime or GitHub is authoritative in this case
- what action the operator can take
