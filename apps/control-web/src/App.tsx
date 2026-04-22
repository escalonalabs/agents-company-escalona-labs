import { Card } from '@escalonalabs/ui';

const operatorViews = [
  {
    eyebrow: 'Company overview',
    heading: 'Objectives and drift',
    body: 'Track active objectives, pending approvals, recent failures, and projection health in one place.',
  },
  {
    eyebrow: 'Objective workspace',
    heading: 'Current owners and blockers',
    body: 'Keep work-item graphs, ownership, blockers, and linked GitHub surfaces close to the operator.',
  },
  {
    eyebrow: 'Run detail',
    heading: 'Evidence before action',
    body: 'Summarize execution packets, artifacts, validation results, and retry history without hidden transcripts.',
  },
] as const;

export default function App() {
  return (
    <main className="app-shell">
      <section className="hero">
        <p className="hero__kicker">Agents Company by Escalona Labs</p>
        <h1 className="hero__title">Control the company, not the chaos.</h1>
        <p className="hero__summary">
          A minimal operator surface for understanding what happened, what is at
          risk, and what can happen next.
        </p>
      </section>

      <section className="card-grid" aria-label="Operator starting points">
        {operatorViews.map((view) => (
          <Card
            key={view.heading}
            eyebrow={view.eyebrow}
            heading={view.heading}
          >
            <p>{view.body}</p>
          </Card>
        ))}
      </section>

      <Card
        className="status-card"
        eyebrow="Current state"
        heading="Scaffold ready for deeper control-plane work"
      >
        <p>
          This starter keeps the app intentionally small: one shared UI package,
          one Vite operator surface, and local TypeScript config inside owned
          paths only.
        </p>
      </Card>
    </main>
  );
}
