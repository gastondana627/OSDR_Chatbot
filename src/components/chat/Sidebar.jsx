import { LogIn, LogOut, Shield, ShieldCheck, User } from "lucide-react";

export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  user = null,
  adminSession = null,
  isAdmin = false,
  activeRoute = "/",
  onOpenAccount,
  onOpenAdmin,
  onSignOut,
}) {
  const displayIdentity =
    user?.displayName ||
    user?.email ||
    adminSession?.displayName ||
    adminSession?.email ||
    "";

  const signedIn = Boolean(user || adminSession?.role === "admin");

  return (
    <aside className="sidebar">
      <button className="new-chat" onClick={onNew}>+ New chat</button>
      <nav className="conv-list">
        {conversations.map((c) => (
          <div
            key={c.id}
            className={"conv-item" + (c.id === activeId ? " active" : "")}
            onClick={() => onSelect(c.id)}
          >
            <span className="conv-title">{c.title || "New chat"}</span>
            <button
              className="conv-del"
              title="Delete"
              onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
            >
              ×
            </button>
          </div>
        ))}
        {!conversations.length && <p className="muted">No conversations yet.</p>}
      </nav>

      <div className="sidebar-auth-box" data-testid="sidebar-auth-box">
        {signedIn ? (
          <div className="sidebar-auth-user">
            <div className="sidebar-auth-id-row">
              <User size={13} className="sidebar-auth-icon" />
              <span className="sidebar-auth-name" title={displayIdentity}>
                {displayIdentity}
              </span>
              {isAdmin && (
                <span className="sidebar-role-badge is-admin">Admin</span>
              )}
            </div>
            <div className="sidebar-auth-actions">
              <button
                type="button"
                className={`sidebar-auth-btn ${activeRoute === "/account" ? "active" : ""}`}
                onClick={onOpenAccount}
                data-testid="sidebar-account-btn"
              >
                Account
              </button>
              <button
                type="button"
                className={`sidebar-auth-btn is-admin ${activeRoute === "/admin" ? "active" : ""}`}
                onClick={onOpenAdmin}
                data-testid="sidebar-admin-btn"
              >
                {isAdmin ? <ShieldCheck size={12} /> : <Shield size={12} />}
                <span>Admin</span>
              </button>
              <button
                type="button"
                className="sidebar-auth-btn is-icon-only"
                title="Sign Out"
                onClick={onSignOut}
                data-testid="sidebar-signout-btn"
              >
                <LogOut size={12} />
              </button>
            </div>
          </div>
        ) : (
          <div className="sidebar-auth-guest">
            <div className="sidebar-auth-id-row">
              <User size={13} className="sidebar-auth-icon" />
              <span className="sidebar-auth-name muted">Guest Research Mode</span>
            </div>
            <div className="sidebar-auth-actions">
              <button
                type="button"
                className={`sidebar-auth-btn is-primary ${activeRoute === "/account" ? "active" : ""}`}
                onClick={onOpenAccount}
                data-testid="sidebar-signin-btn"
              >
                <LogIn size={12} />
                <span>Sign In</span>
              </button>
              <button
                type="button"
                className={`sidebar-auth-btn is-admin ${activeRoute === "/admin" ? "active" : ""}`}
                onClick={onOpenAdmin}
                data-testid="sidebar-admin-portal-btn"
              >
                <Shield size={12} />
                <span>Admin</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <footer className="sidebar-foot muted">History is saved in your browser.</footer>
    </aside>
  );
}
