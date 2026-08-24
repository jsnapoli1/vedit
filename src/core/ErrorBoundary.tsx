import { Component, type ErrorInfo, type ReactNode } from 'react'

export interface VeditErrorBoundaryProps {
  children: ReactNode
  /** Reported with the part that failed, so a host can send it on to its own logging. */
  onError?: (error: Error, info: { part: string; componentStack?: string }) => void
  /** Which piece of the editor this boundary guards, for the report. */
  part: string
  /** Rendered instead of the children once they have thrown. Nothing, by default. */
  fallback?: (error: Error, retry: () => void) => ReactNode
}

interface State {
  error: Error | null
}

/**
 * Keeps a failure inside the editor inside the editor. Without this, a throw
 * while rendering a panel unmounts the whole React tree it lives in — which is
 * the host site's tree, since the provider wraps their app. A visitor who cannot
 * see the editor at all is a far better outcome than a visitor looking at a
 * blank page, so everything this library renders sits behind one of these.
 */
export class VeditErrorBoundary extends Component<VeditErrorBoundaryProps, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, { part: this.props.part, componentStack: info.componentStack ?? undefined })
    if (!this.props.onError) {
      // Silence is worse than a console message nobody asked for.
      console.error(`[vedit] ${this.props.part} failed and was unmounted.`, error)
    }
  }

  private retry = () => this.setState({ error: null })

  render() {
    if (this.state.error) return this.props.fallback?.(this.state.error, this.retry) ?? null
    return this.props.children
  }
}
