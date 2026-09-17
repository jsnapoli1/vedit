import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VeditStore, memoryAdapter } from '../dist/index.js'
import { bindEditorInteractions } from '../dist/internal.js'

/**
 * The listeners only duck-type their targets (`closest`, `getAttribute`), so a
 * page can be stood in for without a DOM: an element is its own ancestor chain,
 * and a document is a registry of capture listeners plus the host's own.
 */
function element({ tag = 'div', attrs = {}, parent = null } = {}) {
  const node = {
    tag,
    parent,
    getAttribute: (name) => attrs[name] ?? null,
    matches(selector) {
      return selector.split(',').some((part) => {
        const [, selectorTag, attribute] = /^([a-z]*)(?:\[([^\]=]+)(?:="([^"]*)")?\])?$/.exec(part.trim()) ?? []
        if (selectorTag && selectorTag !== tag) return false
        if (attribute && attrs[attribute] === undefined) return false
        return true
      })
    },
    closest(selector) {
      let current = node
      while (current) {
        if (current.matches(selector)) return current
        current = current.parent
      }
      return null
    },
  }
  return node
}

function fakeDocument() {
  const capture = new Map()
  const doc = {
    addEventListener: (type, listener) => capture.set(type, listener),
    removeEventListener: (type) => capture.delete(type),
  }
  const view = { addEventListener() {}, removeEventListener() {} }
  return {
    target: { getDocument: () => doc, getWindow: () => view, getViewport: () => ({ originX: 0, originY: 0, zoom: 1 }) },
    /** Dispatch the way a browser would: our capture listener first, then the host's, unless stopped. */
    dispatch(type, target, hostListener) {
      const event = { type, target, defaulted: true, stopped: false }
      event.preventDefault = () => (event.defaulted = false)
      event.stopPropagation = () => (event.stopped = true)
      capture.get(type)?.(event)
      if (!event.stopped) hostListener?.(event)
      return event
    },
  }
}

const makeStore = () => new VeditStore({ key: 'home', adapter: memoryAdapter() })

test('with the hand tool a click reaches the host listener', () => {
  const store = makeStore()
  const page = fakeDocument()
  const unbind = bindEditorInteractions(store, page.target)
  const button = element({ tag: 'button', attrs: { 'data-vedit-id': 'rack.slot' } })

  store.setTool('hand')
  let reached = false
  const event = page.dispatch('click', button, () => (reached = true))

  assert.equal(reached, true)
  assert.equal(event.defaulted, true)
  unbind()
})

test('with the hand tool a link click still does not navigate', () => {
  const store = makeStore()
  const page = fakeDocument()
  bindEditorInteractions(store, page.target)
  const link = element({ tag: 'a', attrs: { href: '/pricing' } })
  const label = element({ tag: 'span', parent: link })

  store.setTool('hand')
  let reached = false
  const event = page.dispatch('click', label, () => (reached = true))

  // The page's own handler on the link still runs; only the navigation is held back.
  assert.equal(reached, true)
  assert.equal(event.defaulted, false)
})

test('with the hand tool a submit is still swallowed', () => {
  const store = makeStore()
  const page = fakeDocument()
  bindEditorInteractions(store, page.target)
  const form = element({ tag: 'form' })

  store.setTool('hand')
  let reached = false
  const event = page.dispatch('submit', form, () => (reached = true))

  assert.equal(reached, false)
  assert.equal(event.defaulted, false)
})

test('with the select tool a click never reaches the host', () => {
  const store = makeStore()
  const page = fakeDocument()
  bindEditorInteractions(store, page.target)
  const button = element({ tag: 'button' })

  let reached = false
  const event = page.dispatch('click', button, () => (reached = true))

  assert.equal(reached, false)
  assert.equal(event.defaulted, false)
})

test('the tool is read when the click happens, not when the listeners were bound', () => {
  const store = makeStore()
  const page = fakeDocument()
  bindEditorInteractions(store, page.target)
  const button = element({ tag: 'button' })

  let reached = 0
  page.dispatch('click', button, () => (reached += 1))
  store.setTool('hand')
  page.dispatch('click', button, () => (reached += 1))
  store.setTool('select')
  page.dispatch('click', button, () => (reached += 1))

  assert.equal(reached, 1)
})
