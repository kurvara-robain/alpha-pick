import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 p-8">
          <div className="max-w-lg rounded-lg border border-rose-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-rose-600">页面渲染出错</h2>
            <pre className="mt-3 max-h-64 overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-600">
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack?.split('\n').slice(0, 8).join('\n')}
            </pre>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-4 rounded bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
            >
              重试
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
