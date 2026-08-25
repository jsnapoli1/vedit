import { migrateDocument } from './core/migrate'
import {
  OperationError,
  applyOperations,
  describeDocument,
  type VeditOperation,
} from './core/operations'
import type { ComponentSummary } from './core/registry'
import { documentToCss } from './runtime/css'
import {
  DEFAULT_BREAKPOINTS,
  emptyDocument,
  type BreakpointWidths,
  type DocumentStage,
  type VeditDocument,
} from './core/types'
import type { VeditServerStore } from './server'

/**
 * A Model Context Protocol server over the same documents the editor writes, so
 * an agent can design: read what a page overrides, restyle it, add a section,
 * check the CSS it would produce, publish it.
 *
 * Written against the wire protocol rather than an SDK, because the library has
 * no runtime dependencies and MCP over JSON-RPC is small enough that adding one
 * would cost more than it saves.
 *
 * Two transports ship with it: `serveStdio` for an editor or desktop client that
 * spawns a process, and `createMcpHandler` for a Fetch-standard HTTP route.
 */

const PROTOCOL_VERSION = '2025-06-18'
const SERVER_NAME = 'vedit'

export interface VeditMcpOptions {
  store: VeditServerStore
  /** Which copy the tools read and write. Drafts by default: agents propose, people publish. */
  stage?: DocumentStage
  /** Used when rendering CSS. Match your `VeditProvider`. */
  breakpoints?: BreakpointWidths
  /** Used when a tool call omits `key`. */
  defaultKey?: string
  /** Refuse documents this returns false for. Without it, every key in the store is reachable. */
  allowKey?: (key: string) => boolean
  /** Set false to expose only the reading tools. */
  writable?: boolean
  /** Reported in `initialize`, so a client can tell builds apart. */
  version?: string
  /**
   * The components an agent may place — `componentManifest(registry)`, or the
   * JSON it produces. Without these, an agent can restyle a page but not compose
   * one; with them it builds pages out of the team's own components.
   */
  components?: ComponentSummary[]
  /** Called after a write lands — `notifyEditors` turns this into a live update. */
  onChange?: (change: { key: string; stage: DocumentStage; doc: VeditDocument; changed: string[] }) => void | Promise<void>
}

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** True when the tool changes stored data. */
  write?: boolean
  run(args: Record<string, unknown>): Promise<unknown>
}

export interface VeditMcpServer {
  readonly tools: McpTool[]
  /** Handle one JSON-RPC message. Returns `null` for notifications, which get no reply. */
  handle(message: unknown): Promise<JsonRpcResponse | null>
  /** Call a tool directly, without the protocol in the way — handy in tests. */
  call(name: string, args?: Record<string, unknown>): Promise<unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/* ------------------------------------------------------------------ server */

export function createVeditMcpServer(options: VeditMcpOptions): VeditMcpServer {
  const {
    store,
    stage = 'draft',
    breakpoints = DEFAULT_BREAKPOINTS,
    defaultKey,
    allowKey,
    writable = true,
    version = '0.3.0',
    onChange,
    components,
  } = options

  const keyOf = (args: Record<string, unknown>): string => {
    const key = typeof args.key === 'string' && args.key ? args.key : defaultKey
    if (!key) throw new Error('`key` is required — call list_documents to see what exists')
    if (allowKey && !allowKey(key)) throw new Error(`\`${key}\` is not available through this server`)
    return key
  }

  const read = async (key: string): Promise<VeditDocument> => {
    const stored = await store.read(key, stage)
    return stored ? migrateDocument(stored, key) : emptyDocument(key)
  }

  const write = async (key: string, operations: VeditOperation[]) => {
    const result = applyOperations(await read(key), operations)
    const doc = { ...result.doc, key, updatedAt: new Date().toISOString() }
    await store.write(doc, stage)
    await onChange?.({ key, stage, doc, changed: result.changed })
    return { key, stage, changed: result.changed, created: result.created, updatedAt: doc.updatedAt }
  }

  const all: McpTool[] = [
    {
      name: 'list_documents',
      description:
        'The documents this server can edit. One document is one editable page; its key is usually the page path.',
      inputSchema: object({}),
      async run() {
        if (!store.list) throw new Error('This store cannot list documents; ask the site owner for the keys')
        return { items: await store.list() }
      },
    },
    {
      name: 'describe_document',
      description:
        'What a page currently overrides, without the style declarations: node ids, which cells are set (style, md, hover:lg), the design tokens. Start here — it is much smaller than the document.',
      inputSchema: object({ key: KEY }),
      async run(args) {
        return describeDocument(await read(keyOf(args)))
      },
    },
    {
      name: 'get_document',
      description: 'The whole override document as JSON. Large; prefer describe_document or get_node.',
      inputSchema: object({ key: KEY }),
      async run(args) {
        return read(keyOf(args))
      },
    },
    {
      name: 'get_node',
      description: "Everything overridden on one element: text, styles per breakpoint and state, props.",
      inputSchema: object({ key: KEY, id: ID }, ['id']),
      async run(args) {
        const doc = await read(keyOf(args))
        const id = String(args.id)
        return doc.nodes[id] ?? { note: `No overrides for \`${id}\` — it renders as the source code says.` }
      },
    },
    {
      name: 'render_css',
      description:
        'The stylesheet these overrides produce, exactly as a visitor would receive it. Use it to check what a change actually does.',
      inputSchema: object({ key: KEY }),
      async run(args) {
        return { css: documentToCss(await read(keyOf(args)), breakpoints) }
      },
    },
    {
      name: 'list_tokens',
      description: 'The named values (brand colours, spacing steps, fonts) this document defines.',
      inputSchema: object({ key: KEY }),
      async run(args) {
        return { items: (await read(keyOf(args))).tokens }
      },
    },
    {
      name: 'list_components',
      description:
        "The components this site is built from, with the props each one accepts. These are the team's own components — placing one gives you their design and behaviour rather than an approximation of it. Read this before composing a page.",
      inputSchema: object({}),
      async run() {
        const list = components ?? (store.listComponents ? await store.listComponents() : [])
        if (!list.length) {
          throw new Error(
            'No components are registered for this site — you can restyle what exists, but not compose new sections',
          )
        }
        return { items: list }
      },
    },
    {
      name: 'list_versions',
      description: 'Earlier saved versions of a document, newest first.',
      inputSchema: object({ key: KEY }),
      async run(args) {
        if (!store.listVersions) throw new Error('This store keeps no history')
        return { items: await store.listVersions(keyOf(args)) }
      },
    },

    {
      name: 'set_styles',
      description:
        'Merge CSS declarations into one element, in one cell of the state × breakpoint matrix. camelCase or kebab-case both work. Declarations you do not name are left alone.',
      write: true,
      inputSchema: object(
        {
          key: KEY,
          id: ID,
          styles: {
            type: 'object',
            description: 'CSS declarations, e.g. { "fontSize": "48px", "color": "var(--vedit-brand)" }',
            additionalProperties: { type: ['string', 'number'] },
          },
          state: STATE,
          breakpoint: BREAKPOINT,
        },
        ['id', 'styles'],
      ),
      async run(args) {
        return write(keyOf(args), [
          {
            op: 'set-styles',
            id: String(args.id),
            styles: args.styles as Record<string, string | number>,
            state: args.state as never,
            breakpoint: args.breakpoint as never,
          },
        ])
      },
    },
    {
      name: 'clear_styles',
      description:
        "Remove declarations from one cell, so the element falls back to the site's own styling. The way to undo a style rather than fight it.",
      write: true,
      inputSchema: object(
        {
          key: KEY,
          id: ID,
          properties: { type: 'array', items: { type: 'string' }, description: 'CSS property names to remove' },
          state: STATE,
          breakpoint: BREAKPOINT,
        },
        ['id', 'properties'],
      ),
      async run(args) {
        return write(keyOf(args), [
          {
            op: 'clear-styles',
            id: String(args.id),
            properties: (args.properties as string[]).map(String),
            state: args.state as never,
            breakpoint: args.breakpoint as never,
          },
        ])
      },
    },
    {
      name: 'set_content',
      description:
        'Change what an element says or points at: text, alt text, image source, link href, or whether it is hidden. Pass null to drop an override and go back to the source code.',
      write: true,
      inputSchema: object(
        {
          key: KEY,
          id: ID,
          text: { type: ['string', 'null'], description: 'Plain text replacement' },
          html: { type: ['string', 'null'], description: 'Rich text; a sanitized subset of HTML' },
          src: { type: ['string', 'null'], description: 'Image source' },
          alt: { type: ['string', 'null'] },
          href: { type: ['string', 'null'] },
          target: { type: ['string', 'null'] },
          className: { type: ['string', 'null'] },
          hidden: { type: ['boolean', 'null'] },
        },
        ['id'],
      ),
      async run(args) {
        const content: Record<string, unknown> = {}
        for (const field of ['text', 'html', 'src', 'alt', 'href', 'target', 'className', 'hidden']) {
          if (field in args) content[field] = args[field]
        }
        return write(keyOf(args), [{ op: 'set-content', id: String(args.id), content }])
      },
    },
    {
      name: 'insert_node',
      description:
        'Add a visual that does not exist in the source code — a heading, an image, an empty box — inside an element that accepts children. Returns the id it was given.',
      write: true,
      inputSchema: object(
        {
          key: KEY,
          parentId: { type: 'string', description: 'Id of the container to add it to' },
          kind: { type: 'string', enum: ['text', 'image', 'box', 'button', 'link'] },
          index: { type: 'number', description: 'Position among its siblings; appended by default' },
        },
        ['parentId', 'kind'],
      ),
      async run(args) {
        return write(keyOf(args), [
          {
            op: 'insert-node',
            parentId: String(args.parentId),
            kind: args.kind as never,
            index: args.index as number | undefined,
          },
        ])
      },
    },
    {
      name: 'place_component',
      description:
        'Put one of the site\'s components into a slot or container, with its props. Call list_components first for the names and what each prop accepts, and describe_document for the container ids. Returns the id it was given, which is what you style or configure afterwards.',
      write: true,
      inputSchema: object(
        {
          key: KEY,
          parentId: {
            type: 'string',
            description: 'Container to place it in — a slot id, or another container from describe_document',
          },
          component: { type: 'string', description: 'Registered component name, from list_components' },
          props: { type: 'object', description: 'Values for the props that component declares' },
          index: { type: 'number', description: 'Position among its siblings; appended by default' },
        },
        ['parentId', 'component'],
      ),
      async run(args) {
        const known = components ?? (store.listComponents ? await store.listComponents() : [])
        const name = String(args.component)
        // Refuse a name the site doesn't have rather than storing a placeholder
        // someone has to find later.
        if (known.length && !known.some((item) => item.id === name)) {
          throw new Error(`No component named \`${name}\`. Available: ${known.map((item) => item.id).join(', ')}`)
        }
        return write(keyOf(args), [
          {
            op: 'insert-node',
            parentId: String(args.parentId),
            kind: 'component',
            component: name,
            index: args.index as number | undefined,
            override: args.props ? { props: args.props as Record<string, unknown> } : undefined,
          },
        ])
      },
    },
    {
      name: 'move_node',
      description: 'Re-order a placed node among its siblings, or move it into a different container.',
      write: true,
      inputSchema: object({ key: KEY, id: ID, parentId: { type: 'string' }, index: { type: 'number' } }, ['id']),
      async run(args) {
        return write(keyOf(args), [
          {
            op: 'move-node',
            id: String(args.id),
            parentId: args.parentId as string | undefined,
            index: args.index as number | undefined,
          },
        ])
      },
    },
    {
      name: 'reset_node',
      description:
        'Drop every override for one element, back to exactly what the source code renders. Also removes it if it was inserted.',
      write: true,
      inputSchema: object({ key: KEY, id: ID }, ['id']),
      async run(args) {
        return write(keyOf(args), [{ op: 'reset-node', id: String(args.id) }])
      },
    },
    {
      name: 'set_token',
      description:
        'Create or update a named value. Referencing it as var(--vedit-<id>) in a style keeps the site consistent and makes a later change one edit instead of twenty.',
      write: true,
      inputSchema: object(
        {
          key: KEY,
          id: { type: 'string', description: 'Slug, e.g. `brand`' },
          name: { type: 'string' },
          kind: { type: 'string', enum: ['color', 'length', 'font', 'shadow'] },
          value: { type: 'string' },
        },
        ['id', 'kind', 'value'],
      ),
      async run(args) {
        return write(keyOf(args), [
          {
            op: 'set-token',
            token: {
              id: String(args.id),
              name: String(args.name ?? args.id),
              kind: args.kind as never,
              value: String(args.value),
            },
          },
        ])
      },
    },
    {
      name: 'apply_operations',
      description:
        'Apply a batch of document operations at once, atomically: if one is malformed none of them land. Everything the other tools do, plus replace-styles, set-props, move-node, remove-node and remove-token. Use it when several changes belong together.',
      write: true,
      inputSchema: object(
        {
          key: KEY,
          operations: {
            type: 'array',
            description:
              'Operations. Each is { "op": …, … }: set-styles | replace-styles | clear-styles (id, styles|properties, state?, breakpoint?), set-content (id, content), set-props (id, props), reset-node (id), insert-node (parentId, kind, id?, index?, override?), move-node (id, parentId?, index?), remove-node (id), set-token (token), remove-token (id).',
            items: { type: 'object' },
          },
        },
        ['operations'],
      ),
      async run(args) {
        return write(keyOf(args), args.operations as VeditOperation[])
      },
    },
    {
      name: 'publish_document',
      description:
        'Make the current draft the version visitors see. The one tool that changes a live site — ask before using it.',
      write: true,
      inputSchema: object({ key: KEY }),
      async run(args) {
        const key = keyOf(args)
        const doc = { ...(await read(key)), updatedAt: new Date().toISOString() }
        await store.write(doc, 'published')
        await onChange?.({ key, stage: 'published', doc, changed: [] })
        return { key, published: true, updatedAt: doc.updatedAt }
      },
    },
    {
      name: 'restore_version',
      description: 'Copy an earlier version back over the working draft.',
      write: true,
      inputSchema: object({ key: KEY, versionId: { type: 'string' } }, ['versionId']),
      async run(args) {
        if (!store.readVersion) throw new Error('This store keeps no history')
        const key = keyOf(args)
        const found = await store.readVersion(key, String(args.versionId))
        if (!found) throw new Error('No such version')
        const doc = { ...migrateDocument(found, key), updatedAt: new Date().toISOString() }
        await store.write(doc, stage)
        await onChange?.({ key, stage, doc, changed: Object.keys(doc.nodes) })
        return { key, restored: String(args.versionId), updatedAt: doc.updatedAt }
      },
    },
  ]

  const tools = all.filter((tool) => writable || !tool.write)

  const byName = new Map(tools.map((tool) => [tool.name, tool]))

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const tool = byName.get(name)
    if (!tool) throw new Error(`No such tool: ${name}`)
    return tool.run(args)
  }

  const handle = async (message: unknown): Promise<JsonRpcResponse | null> => {
    if (!isRecord(message)) return error(null, -32600, 'Not a JSON-RPC message')
    const id = (message.id ?? null) as string | number | null
    const method = typeof message.method === 'string' ? message.method : ''
    const params = isRecord(message.params) ? message.params : {}
    // A notification has no id and takes no reply.
    const notification = message.id === undefined

    try {
      switch (method) {
        case 'initialize':
          return ok(id, {
            protocolVersion:
              typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: SERVER_NAME, version },
            instructions:
              'Edits go to a document of overrides and placed components, not to source code. ' +
              'describe_document first to see what a page has; list_components to see what it can be ' +
              'built from, then place_component into a slot; render_css to check what a change ' +
              'produces. Publishing is a separate, deliberate step.',
          })

        case 'ping':
          return ok(id, {})

        case 'tools/list':
          return ok(id, {
            tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
          })

        case 'tools/call': {
          const name = String(params.name ?? '')
          const args = isRecord(params.arguments) ? params.arguments : {}
          try {
            const result = await call(name, args)
            return ok(id, {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
              structuredContent: isRecord(result) ? result : { result },
            })
          } catch (failure) {
            // A tool that fails reports back through the result, not as a protocol
            // error: the model is meant to read it and try something else.
            return ok(id, { content: [{ type: 'text', text: describeFailure(failure) }], isError: true })
          }
        }

        default:
          if (notification) return null
          return error(id, -32601, `Unsupported method: ${method}`)
      }
    } catch (failure) {
      if (notification) return null
      return error(id, -32603, describeFailure(failure))
    }
  }

  return { tools, handle, call }
}

/* -------------------------------------------------------------- transports */

/**
 * Speak MCP over a pair of streams — what a client that spawns `vedit-mcp` uses.
 * Messages are newline-delimited JSON.
 */
export function serveStdio(
  server: VeditMcpServer,
  streams: {
    input: AsyncIterable<string | Uint8Array>
    output: { write(chunk: string): void }
  },
): Promise<void> {
  return (async () => {
    let buffer = ''
    const decoder = new TextDecoder()
    for await (const chunk of streams.input) {
      buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        if (!line) continue
        let message: unknown
        try {
          message = JSON.parse(line)
        } catch {
          streams.output.write(`${JSON.stringify(error(null, -32700, 'Parse error'))}\n`)
          continue
        }
        const response = await server.handle(message)
        if (response) streams.output.write(`${JSON.stringify(response)}\n`)
      }
    }
  })()
}

/**
 * Speak MCP over HTTP: one JSON-RPC message per POST, the reply in the body.
 * Mount it behind whatever authentication the rest of your API uses — this
 * handler does no authorization of its own.
 */
export function createMcpHandler(server: VeditMcpServer) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify(error(null, -32600, 'Send JSON-RPC messages with POST')), {
        status: 405,
        headers: { 'content-type': 'application/json' },
      })
    }
    let message: unknown
    try {
      message = await request.json()
    } catch {
      return json(error(null, -32700, 'Parse error'))
    }
    // A batch is answered with a batch; notifications drop out of it.
    if (Array.isArray(message)) {
      const responses = (await Promise.all(message.map((item) => server.handle(item)))).filter(Boolean)
      return responses.length ? json(responses) : new Response(null, { status: 204 })
    }
    const response = await server.handle(message)
    return response ? json(response) : new Response(null, { status: 204 })
  }
}

/**
 * Tell open editors that a document moved, by posting a patch to the realtime
 * relay the site already runs. Without this an agent's change shows up on the
 * next reload; with it, it shows up as it happens.
 */
export function notifyEditors(options: {
  /** The `createRealtimeHandler` mount, e.g. `https://example.com/api/vedit/realtime`. */
  endpoint: string
  /** Must match the editor's room — `VeditProvider`'s `realtimeRoom`, or the document key. */
  room?: string
  headers?: Record<string, string>
  fetch?: typeof globalThis.fetch
}) {
  return async (change: { key: string; doc: VeditDocument; changed: string[] }) => {
    const doFetch = options.fetch ?? globalThis.fetch
    const nodes: Record<string, unknown> = {}
    for (const id of change.changed) nodes[id] = change.doc.nodes[id] ?? null
    const url = new URL(options.endpoint)
    url.searchParams.set('room', options.room ?? change.key)
    await doFetch(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...options.headers },
      body: JSON.stringify({
        type: 'patch',
        key: change.key,
        from: `${SERVER_NAME}-mcp`,
        at: Date.now(),
        nodes,
        inserted: change.doc.inserted,
        tokens: change.doc.tokens,
      }),
    }).catch(() => undefined)
  }
}

/* ------------------------------------------------------------------- util */

const KEY = { type: 'string', description: 'Document key, usually the page path. Omit to use the default.' }
const ID = { type: 'string', description: 'Element id, as shown by describe_document' }
const STATE = {
  type: 'string',
  enum: ['default', 'hover', 'focus', 'active'],
  description: 'Interaction state to write into. Defaults to `default`.',
}
const BREAKPOINT = {
  type: 'string',
  enum: ['base', 'sm', 'md', 'lg', 'xl'],
  description: 'Applies from this width up. `base` (the default) applies everywhere.',
}

function object(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function error(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}

function describeFailure(failure: unknown): string {
  if (failure instanceof OperationError) {
    return `Operation ${failure.index} was refused: ${failure.message}`
  }
  return failure instanceof Error ? failure.message : String(failure)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
