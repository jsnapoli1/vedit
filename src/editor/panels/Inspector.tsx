import { useRef, useState } from 'react'
import { useVeditState, useVeditStore } from '../../core/context'
import type { NodeKind, StyleMap } from '../../core/types'
import { LengthField, Row, Section, Segmented, SelectField, Slider, TextField } from '../controls'
import { useComputedStyle, useContentValue, useSelectedNode, useStyleValue } from '../hooks'
import {
  IconAlignCenter,
  IconAlignJustify,
  IconAlignLeft,
  IconAlignRight,
  IconEye,
  IconEyeOff,
  IconTrash,
} from '../icons'
import { BoxSides, ColorRow, LengthRow, SegmentRow, SelectRow } from './rows'

const FONT_STACKS = [
  { value: 'inherit', label: 'Inherit' },
  { value: 'ui-sans-serif, system-ui, sans-serif', label: 'System sans' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Serif' },
  { value: 'ui-monospace, SFMono-Regular, Menlo, monospace', label: 'Mono' },
  { value: 'Inter, sans-serif', label: 'Inter' },
  { value: '"Helvetica Neue", Helvetica, Arial, sans-serif', label: 'Helvetica' },
]

const WEIGHTS = ['300', '400', '500', '600', '700', '800', '900'].map((w) => ({ value: w, label: w }))

const SHADOWS: Array<{ label: string; value: string }> = [
  { label: 'None', value: 'none' },
  { label: 'S', value: '0 1px 2px rgba(0,0,0,.08)' },
  { label: 'M', value: '0 4px 12px rgba(0,0,0,.10)' },
  { label: 'L', value: '0 12px 32px rgba(0,0,0,.16)' },
  { label: 'XL', value: '0 24px 60px rgba(0,0,0,.20)' },
]

export function Inspector() {
  const store = useVeditStore()
  const { id, node } = useSelectedNode()
  const selectionCount = useVeditState((state) => state.selection.length)
  const override = useVeditState((state) => (id ? state.doc.nodes[id] : undefined))
  const isInserted = useVeditState((state) => !!id && state.doc.inserted.some((n) => n.id === id))

  if (!id || selectionCount !== 1) {
    return (
      <aside className="vedit-panel vedit-right" data-vedit-ui="">
        <div className="vedit-panel-head">Inspector</div>
        <div className="vedit-panel-body">
          <div className="vedit-section vedit-hint">
            {selectionCount > 1
              ? `${selectionCount} elements selected. Pick a single element to edit it.`
              : 'Click anything on the page to select it. Double-click text to rewrite it.'}
          </div>
        </div>
      </aside>
    )
  }

  const kind: NodeKind = node?.kind ?? store.kindOf(id)

  return (
    <aside className="vedit-panel vedit-right" data-vedit-ui="">
      <div className="vedit-panel-head">
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textTransform: 'none',
            letterSpacing: 0,
            color: 'var(--vedit-text)',
          }}
        >
          {node?.label ?? 'Element'}
        </span>
        <span style={{ display: 'flex', gap: 2 }}>
          <button
            type="button"
            className="vedit-btn vedit-btn-icon"
            title={override?.hidden ? 'Show' : 'Hide'}
            onClick={() => store.update(id, { hidden: !override?.hidden })}
          >
            {override?.hidden ? <IconEyeOff /> : <IconEye />}
          </button>
          <button
            type="button"
            className="vedit-btn vedit-btn-icon"
            title={isInserted ? 'Delete element' : 'Reset all changes to this element'}
            onClick={() => (isInserted ? store.removeInserted(id) : store.reset(id))}
          >
            <IconTrash />
          </button>
        </span>
      </div>

      <div className="vedit-panel-body">
        <ContentSection id={id} kind={kind} />
        <LayoutSection id={id} />
        {kind !== 'image' ? <TypographySection id={id} /> : null}
        <AppearanceSection id={id} />
        <CustomCssSection id={id} />
        <div className="vedit-section vedit-hint" style={{ wordBreak: 'break-all' }}>
          <div style={{ marginBottom: 4 }}>Node id</div>
          <code>{id}</code>
        </div>
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------ content */

function ContentSection({ id, kind }: { id: string; kind: NodeKind }) {
  const store = useVeditStore()
  const node = store.getNode(id)
  const [text, setText] = useContentValue(id, 'text')
  const [href, setHref] = useContentValue(id, 'href')
  const [target, setTarget] = useContentValue(id, 'target')
  const [src, setSrc] = useContentValue(id, 'src')
  const [alt, setAlt] = useContentValue(id, 'alt')
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  if (kind === 'image') {
    return (
      <Section title="Image">
        {src ? (
          <div
            style={{
              height: 84,
              borderRadius: 6,
              marginBottom: 8,
              background: `#1a1a1a url("${src}") center/contain no-repeat`,
              border: '1px solid var(--vedit-border)',
            }}
          />
        ) : null}
        <Row label="Source">
          <TextField value={src ?? ''} placeholder="https://…" onChange={(next) => setSrc(next || undefined)} />
        </Row>
        <Row>
          <button
            type="button"
            className="vedit-btn"
            style={{ flex: 1, background: 'var(--vedit-panel-2)' }}
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? 'Uploading…' : 'Replace image…'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              setUploading(true)
              try {
                setSrc(await store.uploadImage(file))
              } finally {
                setUploading(false)
                event.target.value = ''
              }
            }}
          />
        </Row>
        <Row label="Alt">
          <TextField value={alt ?? ''} placeholder="Describe the image" onChange={(next) => setAlt(next || undefined)} />
        </Row>
        <SelectRow
          id={id}
          label="Fit"
          property="objectFit"
          options={['cover', 'contain', 'fill', 'none', 'scale-down'].map((v) => ({ value: v, label: v }))}
        />
        <SelectRow
          id={id}
          label="Position"
          property="objectPosition"
          options={['center', 'top', 'bottom', 'left', 'right'].map((v) => ({ value: v, label: v }))}
        />
      </Section>
    )
  }

  const isLinkish = kind === 'link' || kind === 'button'
  if (kind !== 'text' && !isLinkish) return null

  return (
    <Section title="Content">
      <textarea
        className="vedit-textarea"
        value={text ?? node?.sourceText ?? ''}
        placeholder="Type the copy for this element"
        onChange={(event) => setText(event.target.value)}
      />
      {text !== undefined ? (
        <Row>
          <button type="button" className="vedit-btn" style={{ flex: 1 }} onClick={() => setText(undefined)}>
            Restore original copy
          </button>
        </Row>
      ) : null}
      {isLinkish ? (
        <>
          <Row label="Link">
            <TextField value={href ?? ''} placeholder="https://…" onChange={(next) => setHref(next || undefined)} />
          </Row>
          <Row label="Opens">
            <Segmented
              value={target as string | undefined}
              options={[
                { value: '_self', label: 'Same tab' },
                { value: '_blank', label: 'New tab' },
              ]}
              onChange={(next) => setTarget(next)}
            />
          </Row>
        </>
      ) : null}
    </Section>
  )
}

/* ------------------------------------------------------------------- layout */

function LayoutSection({ id }: { id: string }) {
  const display = useStyleValue(id, 'display')
  const computed = useComputedStyle(id)
  const effectiveDisplay = (display.value as string | undefined) ?? computed?.display ?? ''
  const isFlex = effectiveDisplay.includes('flex')
  const isGrid = effectiveDisplay.includes('grid')

  return (
    <Section title="Layout">
      <SelectRow
        id={id}
        label="Display"
        property="display"
        options={['block', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline', 'none'].map((v) => ({
          value: v,
          label: v,
        }))}
      />
      {isFlex ? (
        <>
          <SegmentRow
            id={id}
            label="Direction"
            property="flexDirection"
            options={[
              { value: 'row', label: '→', title: 'Row' },
              { value: 'column', label: '↓', title: 'Column' },
              { value: 'row-reverse', label: '←', title: 'Row reverse' },
              { value: 'column-reverse', label: '↑', title: 'Column reverse' },
            ]}
          />
          <SelectRow
            id={id}
            label="Justify"
            property="justifyContent"
            options={['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'].map(
              (v) => ({ value: v, label: v }),
            )}
          />
          <SelectRow
            id={id}
            label="Align"
            property="alignItems"
            options={['stretch', 'flex-start', 'center', 'flex-end', 'baseline'].map((v) => ({ value: v, label: v }))}
          />
          <SelectRow
            id={id}
            label="Wrap"
            property="flexWrap"
            options={['nowrap', 'wrap', 'wrap-reverse'].map((v) => ({ value: v, label: v }))}
          />
        </>
      ) : null}
      {isGrid ? <LengthRow id={id} label="Columns" property="gridTemplateColumns" /> : null}
      {isFlex || isGrid ? <LengthRow id={id} label="Gap" property="gap" min={0} /> : null}
      <div className="vedit-grid2" style={{ marginBottom: 6 }}>
        <SizeField id={id} property="width" label="W" />
        <SizeField id={id} property="height" label="H" />
        <SizeField id={id} property="minWidth" label="min W" />
        <SizeField id={id} property="maxWidth" label="max W" />
      </div>
      <BoxSides id={id} prefix="padding" label="Padding" />
      <BoxSides id={id} prefix="margin" label="Margin" />
    </Section>
  )
}

function SizeField({ id, property, label }: { id: string; property: string; label: string }) {
  const style = useStyleValue(id, property)
  const unitless = property === 'lineHeight' || property === 'opacity'
  return (
    <LengthField
      label={label}
      value={style.value}
      computed={style.computed}
      onChange={style.set}
      defaultUnit={unitless ? '' : 'px'}
    />
  )
}

/* --------------------------------------------------------------- typography */

function TypographySection({ id }: { id: string }) {
  const family = useStyleValue(id, 'fontFamily')
  return (
    <Section title="Typography">
      <Row label="Font" overridden={family.overridden} onReset={family.clear}>
        <SelectField
          value={family.value}
          computed={family.computed}
          options={FONT_STACKS}
          onChange={family.set}
        />
      </Row>
      <div className="vedit-grid2" style={{ marginBottom: 6 }}>
        <SizeField id={id} property="fontSize" label="Size" />
        <WeightField id={id} />
        <SizeField id={id} property="lineHeight" label="Line" />
        <SizeField id={id} property="letterSpacing" label="Space" />
      </div>
      <SegmentRow
        id={id}
        label="Align"
        property="textAlign"
        options={[
          { value: 'left', label: <IconAlignLeft width={12} height={12} />, title: 'Left' },
          { value: 'center', label: <IconAlignCenter width={12} height={12} />, title: 'Center' },
          { value: 'right', label: <IconAlignRight width={12} height={12} />, title: 'Right' },
          { value: 'justify', label: <IconAlignJustify width={12} height={12} />, title: 'Justify' },
        ]}
      />
      <ColorRow id={id} label="Color" property="color" />
      <SelectRow
        id={id}
        label="Transform"
        property="textTransform"
        options={['none', 'uppercase', 'lowercase', 'capitalize'].map((v) => ({ value: v, label: v }))}
      />
      <SelectRow
        id={id}
        label="Decoration"
        property="textDecoration"
        options={['none', 'underline', 'line-through'].map((v) => ({ value: v, label: v }))}
      />
    </Section>
  )
}

function WeightField({ id }: { id: string }) {
  const weight = useStyleValue(id, 'fontWeight')
  return (
    <SelectField value={weight.value} computed={weight.computed} options={WEIGHTS} onChange={weight.set} />
  )
}

/* --------------------------------------------------------------- appearance */

function AppearanceSection({ id }: { id: string }) {
  const opacity = useStyleValue(id, 'opacity')
  const shadow = useStyleValue(id, 'boxShadow')
  return (
    <Section title="Appearance">
      <ColorRow id={id} label="Fill" property="backgroundColor" />
      <LengthRow id={id} label="Radius" property="borderRadius" min={0} />
      <LengthRow id={id} label="Border" property="borderWidth" min={0} />
      <ColorRow id={id} label="Stroke" property="borderColor" />
      <SelectRow
        id={id}
        label="Style"
        property="borderStyle"
        options={['solid', 'dashed', 'dotted', 'none'].map((v) => ({ value: v, label: v }))}
      />
      <Row label="Opacity" overridden={opacity.overridden} onReset={opacity.clear}>
        <Slider value={opacity.value} fallback={Number(opacity.computed || 1)} onChange={opacity.set} />
      </Row>
      <Row label="Shadow" overridden={shadow.overridden} onReset={shadow.clear}>
        <div className="vedit-segmented">
          {SHADOWS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              data-active={shadow.value === preset.value ? 'true' : 'false'}
              onClick={() => shadow.set(preset.value)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </Row>
    </Section>
  )
}

/* --------------------------------------------------------------- custom css */

function CustomCssSection({ id }: { id: string }) {
  const store = useVeditStore()
  const breakpoint = useVeditState((state) => state.breakpoint)
  const override = useVeditState((state) => state.doc.nodes[id])
  const bucket = (breakpoint === 'base' ? override?.style : override?.responsive?.[breakpoint]) ?? {}
  const [draft, setDraft] = useState<string | null>(null)
  const serialized = Object.entries(bucket)
    .map(([property, value]) => `${property}: ${value};`)
    .join('\n')

  return (
    <Section title="Custom CSS" defaultOpen={false}>
      <div className="vedit-hint" style={{ marginBottom: 6 }}>
        Anything the panels above don't cover. One declaration per line.
      </div>
      <textarea
        className="vedit-textarea"
        spellCheck={false}
        value={draft ?? serialized}
        placeholder={'box-shadow: 0 2px 6px #0002;\nbackdrop-filter: blur(4px);'}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== null) store.setStyleBucket(id, parseDeclarations(draft))
          setDraft(null)
        }}
      />
    </Section>
  )
}

function parseDeclarations(source: string): StyleMap {
  const styles: StyleMap = {}
  for (const line of source.split(/[\n;]+/)) {
    const index = line.indexOf(':')
    if (index < 1) continue
    const property = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (property && value) styles[property] = value
  }
  return styles
}
