import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Application Error Caught by Boundary:", error, errorInfo);
  }

  handleReset = () => {
    try {
      localStorage.removeItem("osdr-conversations");
    } catch {
      // ignore
    }
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#080c14",
          color: "#e2e8f0",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "24px"
        }}>
          <div style={{
            maxWidth: "540px",
            width: "100%",
            background: "#0f172a",
            border: "1px solid #334155",
            borderRadius: "12px",
            padding: "28px",
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
              <span style={{ fontSize: "24px" }}>⚠️</span>
              <h2 style={{ margin: 0, fontSize: "18px", color: "#f87171" }}>
                Application State Recovery
              </h2>
            </div>
            <p style={{ fontSize: "14px", color: "#94a3b8", lineHeight: "1.6", marginBottom: "20px" }}>
              The application encountered a storage or runtime exception. Your session can be safely recovered.
            </p>
            {this.state.error?.message && (
              <pre style={{
                background: "#090d16",
                padding: "12px",
                borderRadius: "8px",
                fontSize: "12px",
                color: "#cbd5e1",
                overflowX: "auto",
                marginBottom: "20px",
                border: "1px solid #1e293b"
              }}>
                {this.state.error.message}
              </pre>
            )}
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                style={{
                  flex: 1,
                  padding: "10px 16px",
                  borderRadius: "8px",
                  background: "#1e293b",
                  color: "#ffffff",
                  border: "1px solid #475569",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Try Again
              </button>
              <button
                onClick={this.handleReset}
                style={{
                  flex: 1,
                  padding: "10px 16px",
                  borderRadius: "8px",
                  background: "#0284c7",
                  color: "#ffffff",
                  border: "none",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Clear Cache & Reload
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
