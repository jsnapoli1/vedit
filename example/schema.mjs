/**
 * What the catalog demo stores: the sources `content-server.mjs` serves and
 * `bin/vedit-mcp.mjs --schema ./example/schema.mjs` reads. Plain data, shared
 * by both, so the server and the command can never disagree about a field.
 *
 * Imported from the built bundle rather than from `vedit/content`: this file
 * runs under Node from a checkout of the repository, where the package is not
 * installed under its own name and the Vite alias the browser side relies on
 * does not apply. Run `npm run build` first.
 */
import { defineCollections, defineGlobals } from '../dist/content.js'

export const collections = defineCollections({
  products: {
    label: 'Products',
    titleField: 'title',
    orderField: 'position',
    fields: {
      title: { type: 'text', required: true },
      blurb: 'richtext',
      datasheet: { type: 'file', label: 'Datasheet' },
      category: { type: 'relation', to: 'categories' },
      price: 'number',
      position: 'number',
    },
  },
  categories: {
    label: 'Categories',
    titleField: 'name',
    fields: {
      name: { type: 'text', required: true },
    },
  },
})

export const globals = defineGlobals({
  site: {
    label: 'Site',
    fields: {
      tagline: 'text',
      contact: 'text',
    },
  },
})
