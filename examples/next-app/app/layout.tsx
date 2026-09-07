/**
 * Deliberately a Server Component with no 'use client' of its own. This is the
 * claim INTEGRATING.md makes about the App Router: the browser half of the
 * bundle carries its own directive, so the provider can be used straight from a
 * server layout and children pass through it untouched.
 */
import type { ReactNode } from 'react'
import { VeditProvider } from 'vedit'

export const metadata = { title: 'vedit — Next App Router' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <VeditProvider documentKey="next-app" enabled>
          {children}
        </VeditProvider>
      </body>
    </html>
  )
}
