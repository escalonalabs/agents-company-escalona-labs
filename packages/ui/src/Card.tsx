import type { ComponentPropsWithoutRef, PropsWithChildren } from 'react';

export type CardProps = PropsWithChildren<
  ComponentPropsWithoutRef<'section'> & {
    eyebrow?: string;
    heading?: string;
  }
>;

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(' ');
}

export function Card({
  eyebrow,
  heading,
  children,
  className,
  ...props
}: CardProps) {
  return (
    <section className={joinClassNames('ui-card', className)} {...props}>
      {(eyebrow || heading) && (
        <header className="ui-card__header">
          {eyebrow ? <p className="ui-card__eyebrow">{eyebrow}</p> : null}
          {heading ? <h2 className="ui-card__heading">{heading}</h2> : null}
        </header>
      )}
      {children ? <div className="ui-card__body">{children}</div> : null}
    </section>
  );
}
