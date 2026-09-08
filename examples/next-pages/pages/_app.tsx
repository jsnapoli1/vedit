/** The Pages Router claim from INTEGRATING.md: wrap in `pages/_app.tsx`. */
import type { AppProps } from 'next/app'
import { VeditProvider } from 'vedit'

export default function App({ Component, pageProps }: AppProps) {
  return (
    <VeditProvider documentKey="next-pages" enabled>
      <Component {...pageProps} />
    </VeditProvider>
  )
}
