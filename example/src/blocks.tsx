import type { ReactNode } from 'react'
import { defineComponents } from 'vedit'

/**
 * The site's own components, and the schema that lets the editor place them.
 *
 * Nothing here imports anything from vedit except `defineComponents`, and that is
 * only a typed pass-through — every component below is ordinary React that would
 * work exactly the same rendered by hand. The registry is the seam: it says which
 * props a person may change and what to call them, and nothing more.
 */

interface SectionProps {
  align?: 'left' | 'center'
  tone?: 'plain' | 'tint'
}

export function Banner({
  eyebrow,
  headline,
  body,
  action,
  align = 'left',
  tone = 'plain',
}: SectionProps & {
  eyebrow?: string
  headline?: string
  body?: string
  action?: string
}) {
  return (
    <section className={`block block-banner tone-${tone} align-${align}`}>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h2>{headline}</h2>
      {body ? <p className="block-body">{body}</p> : null}
      {action ? (
        <a className="btn btn-solid btn-md" href="#start">
          {action}
        </a>
      ) : null}
    </section>
  )
}

export function FeatureRow({
  title,
  items,
  columns = 3,
}: {
  title?: string
  items?: string
  columns?: number
}) {
  // A textarea of one feature per line: the simplest thing that lets a person add
  // a fourth feature without a developer, and without inventing a nested editor.
  const features = (items ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return (
    <section className="block block-features">
      {title ? <h2>{title}</h2> : null}
      <div className="features" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, padding: 0 }}>
        {features.map((feature, index) => {
          const [heading, ...rest] = feature.split('—')
          return (
            <div className="card" key={index}>
              <h3>{heading.trim()}</h3>
              {rest.length ? <p>{rest.join('—').trim()}</p> : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function Quote({ quote, name, role }: { quote?: string; name?: string; role?: string }) {
  return (
    <section className="block block-quote">
      <blockquote>{quote}</blockquote>
      <p className="quote-by">
        <strong>{name}</strong>
        {role ? `, ${role}` : ''}
      </p>
    </section>
  )
}

/** A layout component: whatever the editor puts inside it renders as its children. */
export function Split({ children, ratio = 'even' }: { children?: ReactNode; ratio?: 'even' | 'wide-left' }) {
  return <section className={`block block-split ratio-${ratio}`}>{children}</section>
}

export const blocks = defineComponents({
  Banner: {
    component: Banner,
    group: 'Sections',
    description: 'A headline with optional eyebrow, body and call to action.',
    fields: [
      { name: 'eyebrow', type: 'text' },
      { name: 'headline', type: 'text' },
      { name: 'body', type: 'textarea' },
      { name: 'action', label: 'Button label', type: 'text' },
      { name: 'align', type: 'select', options: ['left', 'center'] },
      { name: 'tone', type: 'select', options: ['plain', 'tint'] },
    ],
    defaults: {
      eyebrow: 'New',
      headline: 'A headline worth reading',
      body: 'One or two lines that say what this is and who it is for.',
      action: 'Start free',
      align: 'left',
      tone: 'plain',
    },
  },

  FeatureRow: {
    component: FeatureRow,
    group: 'Sections',
    description: 'A grid of short features. One per line, `Title — description`.',
    fields: [
      { name: 'title', type: 'text' },
      { name: 'items', label: 'Features', type: 'textarea', help: 'One per line: Title — description' },
      { name: 'columns', type: 'number', min: 1, max: 4, step: 1 },
    ],
    defaults: {
      title: 'What you get',
      items: 'Edit in place — Click anything and change it where it lives.\nResponsive — Tune each breakpoint on its own.\nYour storage — Overrides are plain JSON.',
      columns: 3,
    },
  },

  Quote: {
    component: Quote,
    group: 'Social proof',
    description: 'One customer quote with attribution.',
    fields: [
      { name: 'quote', type: 'textarea' },
      { name: 'name', type: 'text' },
      { name: 'role', type: 'text' },
    ],
    defaults: {
      quote: 'We shipped the redesign in an afternoon, and nobody had to open the repo.',
      name: 'Ada Okafor',
      role: 'Head of Marketing',
    },
  },

  Split: {
    component: Split,
    group: 'Layout',
    description: 'Two columns. Drop other components inside it.',
    container: true,
    fields: [{ name: 'ratio', type: 'select', options: ['even', 'wide-left'] }],
    defaults: { ratio: 'even' },
  },
})
