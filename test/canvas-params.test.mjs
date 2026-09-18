import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keepCanvasParams } from '../dist/internal.js'

/** Enough of a window for the history patch: a location and a history that records writes. */
function fakeWindow(href) {
  const writes = []
  const win = {
    location: new URL(href),
    history: {
      pushState(_data, _unused, url) { writes.push(['push', url]) },
      replaceState(_data, _unused, url) { writes.push(['replace', url]) },
    },
  }
  return { win, writes }
}

test('a canvas child keeps its params through in-page navigation', () => {
  const { win, writes } = fakeWindow('https://site.test/?vedit-canvas=1&vedit-vh=900')
  const release = keepCanvasParams(win)
  win.history.pushState({}, '', '/blog/42')
  win.history.replaceState({}, '', '/blog/42?tab=comments#top')
  win.history.pushState({}, '', null)
  assert.deepEqual(writes, [
    ['push', '/blog/42?vedit-canvas=1&vedit-vh=900'],
    ['replace', '/blog/42?tab=comments&vedit-canvas=1&vedit-vh=900#top'],
    ['push', null],
  ])
  release()
  win.history.pushState({}, '', '/plain')
  assert.deepEqual(writes.at(-1), ['push', '/plain'])
})

test('a page that is not a canvas child is left alone', () => {
  const { win, writes } = fakeWindow('https://site.test/pricing')
  keepCanvasParams(win)
  win.history.pushState({}, '', '/blog/42')
  assert.deepEqual(writes, [['push', '/blog/42']])
})
