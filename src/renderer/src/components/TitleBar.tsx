import { useEffect, useState } from 'react'

/**
 * Custom in-app title bar for the frameless window (Story #42). The OS frame is removed in
 * the main process (`frame: false`); this bar replaces it with the app title (a draggable
 * region) and the minimize / maximize-restore / close controls, driven over the typed IPC
 * bridge (`window.api`). The renderer holds no window logic — it sends commands and reflects
 * the maximize state the main process reports.
 *
 * Drag vs. no-drag is expressed with CSS `-webkit-app-region` (see app.css): the bar drags,
 * the controls do not, so they stay clickable and keyboard-focusable.
 */
export function TitleBar(): React.JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    // Seed the icon from the current window state, then track subsequent changes — including
    // OS-driven ones (double-click on the drag region, window snapping).
    void window.api.isWindowMaximized().then(setIsMaximized)
    return window.api.onWindowMaximizeChanged(setIsMaximized)
  }, [])

  return (
    <div className="titlebar">
      <div className="titlebar-drag">
        <span className="titlebar-title">Stock Portfolio Viewer</span>
      </div>
      <div className="titlebar-controls">
        <button
          type="button"
          className="titlebar-button"
          aria-label="Minimize"
          title="Minimize"
          onClick={() => window.api.minimizeWindow()}
        >
          <MinimizeIcon />
        </button>
        <button
          type="button"
          className="titlebar-button"
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          title={isMaximized ? 'Restore' : 'Maximize'}
          onClick={() => window.api.toggleMaximizeWindow()}
        >
          {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button
          type="button"
          className="titlebar-button titlebar-button-close"
          aria-label="Close"
          title="Close"
          onClick={() => window.api.closeWindow()}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}

/* Dependency-free inline SVG icons, matching the project's inline-SVG convention. They
   inherit the button colour via `currentColor` and are hidden from assistive tech (the
   button's aria-label carries the meaning). */

function MinimizeIcon(): React.JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

function MaximizeIcon(): React.JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

function RestoreIcon(): React.JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      {/* Back window */}
      <rect x="2.5" y="0.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
      {/* Front window */}
      <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

function CloseIcon(): React.JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1" />
      <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}
