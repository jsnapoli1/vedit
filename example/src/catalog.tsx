import {
  Editable,
  EditableFile,
  EditableText,
  VeditProvider,
  httpAdapter,
  useVeditEditing,
  useVeditRecords,
  type VeditRecord,
} from 'vedit'
import { httpContentClient } from 'vedit/content'

/**
 * The half of the demo where vedit owns the content. Everything on these pages
 * comes from `content-server.mjs`: the rows, the tagline, the datasheets, the
 * overrides, and the sign-in gate. The other routes keep their localStorage
 * adapter, so this file is the only place the two set-ups meet.
 */
const PAGES = [
  { path: '/catalog', label: 'Catalog' },
  { path: '/catalog/sheet', label: 'Price sheet' },
]

const catalogAdapter = httpAdapter({
  endpoint: '/vedit',
  mediaEndpoint: '/vedit/v1/media',
  staged: true,
})

const catalogContent = httpContentClient({ endpoint: '/vedit' })

/** The provider for the `/catalog*` routes: one document per page, one shared `site` document, sign-in from the server. */
export function CatalogApp({ path, canvas, user }: { path: string; canvas: boolean; user?: { id: string; name: string } }) {
  return (
    <VeditProvider
      key={path}
      canvas={canvas}
      adapter={catalogAdapter}
      content={catalogContent}
      enabled="auth"
      sharedKeys={['site']}
      pages={PAGES}
      user={user}
    >
      {path.startsWith('/catalog/sheet') ? <SheetPage /> : <CatalogPage />}
    </VeditProvider>
  )
}

/**
 * Rendered on every catalog page and stored once, as the `site` document, so a
 * change made to the nav on one page is already there on the next.
 */
function CatalogNav() {
  const [editing, setEditing] = useVeditEditing()
  return (
    <Editable id="catalog-nav" as="nav" className="nav" scope="site" container>
      <EditableText id="catalog-nav.brand" as="span" className="brand">
        Northwind Parts
      </EditableText>
      <div className="nav-links">
        <a href="/catalog">Catalog</a>
        <a href="/catalog/sheet">Price sheet</a>
        <EditableText id="tagline" as="span" className="tagline" bind={{ source: 'site', id: 'global', field: 'tagline' }}>
          Parts that ship the day you order.
        </EditableText>
      </div>
      <button type="button" onClick={() => setEditing(!editing)}>
        {editing ? 'Close editor' : 'Edit page'}
      </button>
    </Editable>
  )
}

function CatalogPage() {
  const rows = useVeditRecords('products', { orderBy: 'position' })
  return (
    <>
      <CatalogNav />
      <section className="hero" style={{ paddingBottom: 0 }}>
        <div>
          <EditableText id="catalog.eyebrow" className="eyebrow">
            Catalog
          </EditableText>
          <EditableText id="catalog.title" as="h1">
            Every part, straight from the records.
          </EditableText>
        </div>
      </section>
      <section className="features">
        <Editable id="products" repeat={rows} source="products" newRow={{ category: 'cat-power', price: 0 }}>
          <div className="card">
            <Editable id="products.title" as="h3" bind="title">
              Untitled
            </Editable>
            <Editable id="products.blurb" as="div" className="card-body" bind="blurb" />
            <EditableFile id="products.datasheet" className="btn btn-outline btn-sm" href="#" bind="datasheet">
              Datasheet
            </EditableFile>
          </div>
        </Editable>
      </section>
      <footer className="footer">
        <p>© Northwind. These cards are rows in a content store, not JSX.</p>
      </footer>
    </>
  )
}

/** The same rows as a table: a second page in the same store, so a nav edit and a title edit show on both. */
function SheetPage() {
  const rows = useVeditRecords('products', { orderBy: 'position' })
  return (
    <>
      <CatalogNav />
      <section className="hero" style={{ paddingBottom: 0 }}>
        <div>
          <EditableText id="sheet.eyebrow" className="eyebrow">
            Price sheet
          </EditableText>
          <EditableText id="sheet.title" as="h1">
            Prices at a glance.
          </EditableText>
        </div>
      </section>
      <section className="sheet">
        <table className="sheet-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{textOf(row.title)}</td>
                <td>{priceOf(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <footer className="footer">
        <p>© Northwind. Prices shown in USD.</p>
      </footer>
    </>
  )
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function priceOf(row: VeditRecord): string {
  return typeof row.price === 'number' ? `$${row.price}` : '—'
}
