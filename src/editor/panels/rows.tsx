import type { ReactNode } from 'react'
import { ColorField, LengthField, Row, SelectField, Segmented } from '../controls'
import { useStyleValue } from '../hooks'

export function LengthRow({
  id,
  label,
  property,
  step,
  min,
}: {
  id: string
  label: string
  property: string
  step?: number
  min?: number
}) {
  const style = useStyleValue(id, property)
  return (
    <Row label={label} overridden={style.overridden} onReset={style.clear}>
      <LengthField value={style.value} computed={style.computed} onChange={style.set} step={step} min={min} />
    </Row>
  )
}

export function SelectRow({
  id,
  label,
  property,
  options,
}: {
  id: string
  label: string
  property: string
  options: Array<{ value: string; label: string }>
}) {
  const style = useStyleValue(id, property)
  return (
    <Row label={label} overridden={style.overridden} onReset={style.clear}>
      <SelectField value={style.value} computed={style.computed} options={options} onChange={style.set} />
    </Row>
  )
}

export function ColorRow({ id, label, property }: { id: string; label: string; property: string }) {
  const style = useStyleValue(id, property)
  return (
    <Row label={label} overridden={style.overridden} onReset={style.clear}>
      <ColorField value={style.value} computed={style.computed} onChange={style.set} />
    </Row>
  )
}

export function SegmentRow({
  id,
  label,
  property,
  options,
}: {
  id: string
  label: string
  property: string
  options: Array<{ value: string; label: ReactNode; title?: string }>
}) {
  const style = useStyleValue(id, property)
  return (
    <Row label={label} overridden={style.overridden} onReset={style.clear}>
      <Segmented value={style.value as string | undefined} options={options} onChange={style.set} />
    </Row>
  )
}

/** Four-up padding/margin editor. */
export function BoxSides({ id, prefix, label }: { id: string; prefix: 'padding' | 'margin'; label: string }) {
  const sides = ['Top', 'Right', 'Bottom', 'Left'] as const
  return (
    <div style={{ marginBottom: 6 }}>
      <div className="vedit-label" style={{ marginBottom: 4, width: 'auto' }}>
        {label}
      </div>
      <div className="vedit-grid4">
        {sides.map((side) => (
          <SideField key={side} id={id} property={`${prefix}${side}`} label={side[0]} />
        ))}
      </div>
    </div>
  )
}

function SideField({ id, property, label }: { id: string; property: string; label: string }) {
  const style = useStyleValue(id, property)
  return <LengthField label={label} value={style.value} computed={style.computed} onChange={style.set} min={0} />
}
