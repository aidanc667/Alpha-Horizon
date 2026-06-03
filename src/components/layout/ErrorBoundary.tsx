'use client';

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props { children: React.ReactNode; label?: string }
interface State { error: Error | null }

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-4 px-8 text-center">
        <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center">
          <AlertTriangle className="w-6 h-6 text-red-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-zinc-800">{this.props.label ?? 'Something went wrong'}</p>
          <p className="text-xs text-zinc-400 mt-1 font-mono max-w-sm">{this.state.error.message}</p>
        </div>
        <button
          onClick={() => this.setState({ error: null })}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-zinc-100 hover:bg-zinc-200 rounded-xl transition-colors"
        >
          <RefreshCw className="w-3 h-3" /> Try again
        </button>
      </div>
    );
  }
}
