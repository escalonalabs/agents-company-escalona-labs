# Technical Naming System

## Naming principles

- one canonical name per technical surface
- editorial branding and technical identifiers are related but not interchangeable
- no visible legacy product identifiers remain in the new system

## Canonical map

| Surface | Canonical name |
| --- | --- |
| Editorial product name | `Agents Company by Escalona Labs` |
| Product short name | `Agents Company` |
| Technical short name | `agents-company` |
| Repository slug | `agents-company-escalona-labs` |
| GitHub owner | `escalonalabs` |
| npm scope | `@escalonalabs/*` |
| Primary Go module root | `github.com/escalonalabs/agents-company-escalona-labs/server` |
| Public CLI | `agents-company` |
| Desktop app id | `labs.escalona.agentscompany.desktop` |
| Deep link scheme | `agents-company://` |
| Environment prefix | `AGENTS_COMPANY_` |
| Storage key prefix | `agents_company_` |
| Local state directory | `~/.agents-company` |
| Local workspace root | `~/agents_company_workspaces` |
| Release channel prefix | `agents-company-` |

## Package naming rules

- published or internal packages use `@escalonalabs/<package-name>`
- package names stay descriptive by bounded context, for example:
  - `@escalonalabs/domain`
  - `@escalonalabs/kernel`
  - `@escalonalabs/github`
  - `@escalonalabs/ui`

## Go naming rules

- the first Go module lives under `server/`
- subpackages should follow context-driven names such as `internal/kernel`, `internal/githubsync`, and `internal/orchestration`
- no legacy brand identifiers may appear in module paths, package names, or generated import paths

## App and integration naming rules

- UI apps should use descriptive folder names such as `control-web`
- server processes should use role-based names such as `control-plane` and `github-app`
- integrations should describe their responsibility, not their transport alone

## Persistence naming rules

- environment variables use uppercase `AGENTS_COMPANY_*`
- database schemas, tables, queues, and buckets should prefer `agents_company_*`
- no user-facing storage key should expose legacy names

## Release and distribution rules

- release names and artifacts start with `agents-company-`
- repository docs should call the product `Agents Company by Escalona Labs` on first mention and `Agents Company` thereafter
- executable surfaces should prefer the shorter technical identifier when brevity matters

## Reserved words

- `Escalona Labs` is reserved for company attribution and formal brand contexts
- `Agents Company` is reserved for product-facing references
- `agents-company` is reserved for technical identifiers, paths, and executable surfaces
