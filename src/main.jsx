import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { StoreProvider } from './store.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { installAudioUnlock } from './lib/audioUnlock'
import './index.css'

// Resume the AudioContext on the user's very first gesture, before any sound is
// asked for. Without this the first hover/click stalls on a resume that never
// settles and everything after it queues up silently.
installAudioUnlock()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <StoreProvider>
        <App />
      </StoreProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
