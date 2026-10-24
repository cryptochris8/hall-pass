// Debug hooks (docs/ARCHITECTURE.md §14): window.__HP__ with ?test=1 (always in dev).
import type { App } from './app';

declare global {
  interface Window {
    __HP__?: ReturnType<App['debugApi']>;
  }
}

export function installDebugHooks(app: App): void {
  window.__HP__ = app.debugApi();
}
