import { Component } from 'react'

/**
 * ErrorBoundary — catches render/runtime throws (and failed lazy-chunk loads) so a
 * single broken component degrades to a recoverable message instead of white-
 * screening the whole app. Wrap the app root AND each lazy <Suspense> boundary.
 *
 * Props:
 *   label     — short name of the area (e.g. "AR Studio") for the message
 *   onReset   — optional; called by the "Try again" button (defaults to remount)
 *   children
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Surface it for debugging without taking the app down.
    console.error(`[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ''}]`, error, info?.componentStack)
  }

  reset = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render() {
    if (!this.state.error) return this.props.children

    const chunkFailed = /Loading chunk|dynamically imported module|Failed to fetch/i.test(
      this.state.error?.message || '',
    )
    return (
      <div className="glass p-8 sm:p-10 max-w-lg mx-auto text-center my-6">
        <div className="text-5xl mb-3">😵‍💫</div>
        <h3 className="font-bold text-lg mb-2">
          {this.props.label ? `${this.props.label} hit a snag` : 'Something went wrong'}
        </h3>
        <p className="text-sm text-white/55 mb-5">
          {chunkFailed
            ? 'This section could not finish loading — often a network hiccup. Check your connection and try again.'
            : 'An unexpected error occurred in this section. The rest of the app is still fine.'}
        </p>
        <div className="flex items-center justify-center gap-3">
          <button onClick={this.reset} className="btn-primary">Try again</button>
          <button onClick={() => window.location.reload()} className="btn-ghost">Reload app</button>
        </div>
        {import.meta.env.DEV && (
          <pre className="text-left text-[11px] text-rose-300/80 mt-4 max-h-40 overflow-auto whitespace-pre-wrap">
            {String(this.state.error?.stack || this.state.error)}
          </pre>
        )}
      </div>
    )
  }
}
