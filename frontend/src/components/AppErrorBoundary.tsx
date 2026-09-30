import { Component, createRef, type ReactNode } from "react";

/** Last-resort render recovery. Never retain or display private exception details. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  private heading = createRef<HTMLHeadingElement>();

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // The workspace and its focused control have been removed. Announce the new screen.
    this.heading.current?.focus();
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="mc-scope mc-fatal" aria-labelledby="mc-fatal-title">
        <section className="mc-fatal-card" role="alert">
          <p className="mc-fatal-eyebrow">CompCat</p>
          <h1 id="mc-fatal-title" ref={this.heading} tabIndex={-1} aria-describedby="mc-fatal-description">
            This page needs a fresh start
          </h1>
          <p id="mc-fatal-description">
            CompCat could not finish loading this screen. Reload the page to start again. If
            the problem continues, try again later.
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload CompCat
          </button>
        </section>
      </main>
    );
  }
}
