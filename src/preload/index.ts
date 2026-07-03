// Preload stub.
//
// Story #9 only needs a launchable shell, so this preload intentionally exposes
// nothing yet. Story #10 replaces this with a typed `contextBridge` API and the
// first end-to-end IPC channel (`app:ping`). Keeping it empty for now preserves
// the secure defaults (context isolation on, no Node integration in the renderer).

export {}
