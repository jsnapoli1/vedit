/** The Remix claim: wrap wherever the app root is. */
import { Links, Meta, Outlet, Scripts } from '@remix-run/react'
import { VeditProvider } from 'vedit'

export default function App() {
  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        <VeditProvider documentKey="remix" enabled>
          <Outlet />
        </VeditProvider>
        <Scripts />
      </body>
    </html>
  )
}
