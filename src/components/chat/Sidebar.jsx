import { LogIn, LogOut, Radar, Shield, ShieldCheck, User } from "lucide-react";
import {
  computeProfileInitials,
  getAvatarAccentSpec,
  getSubgroupSpec,
} from "../../utils/researcherProfile.js";

export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  user = null,
  adminSession = null,
  researcherProfile = null,
  isAdmin = false,
  activeRoute = "/",
  onOpenAccount,
  onOpenAdmin,
  onOpenRyanRadar,
  onSignOut,
}) {
  const displayIdentity =
    researcherProfile?.displayName ||
    user?.displayName ||
    user?.email ||
    adminSession?.displayName ||
    adminSession?.email ||
    "";

  const signedIn = Boolean(user || adminSession?.role === "admin");
  const accentSpec = getAvatarAccentSpec(researcherProfile?.avatarAccent);
  const initials = signedIn ? computeProfileInitials(researcherProfile, user) : "";
  const checkedSubgroups = Array.isArray(researcherProfile?.awgSubgroups)
    ? researcherProfile.awgSubgroups
    : [];

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

      {onOpenRyanRadar && (
        <div className="ryan-sidebar-pulse" data-testid="sidebar-ryan-pulse">
          <button
            type="button"
            className="ryan-sidebar-pulse-btn"
            onClick={onOpenRyanRadar}
            title="Open Ryan T. Scott 8-Hour Scholar & Pre-OSDR Release Radar"
          >
            <span className="ryan-pulse-dot" />
            <span className="ryan-sidebar-pulse-text">
              <strong>Ryan T. Scott</strong> · 8h Scholar Watch
            </span>
            <Radar size={12} />
          </button>
        </div>
      )}

      <div className="sidebar-auth-box" data-testid="sidebar-auth-box">
        {signedIn ? (
          <div className="sidebar-auth-user">
            <div className="sidebar-auth-id-row">
              <span
                className="sidebar-avatar-pill"
                style={{ background: accentSpec.bg }}
                aria-hidden="true"
              >
                {initials}
              </span>
              <span className="sidebar-auth-name" title={displayIdentity}>
                {displayIdentity}
              </span>
              {isAdmin && (
                <span className="sidebar-role-badge is-admin">Admin</span>
              )}
            </div>
            {checkedSubgroups.length > 0 && (
              <div className="sidebar-awg-chips" data-testid="sidebar-awg-chips">
                {checkedSubgroups.slice(0, 2).map((id) => {
                  const spec = getSubgroupSpec(id);
                  return (
                    <span
                      key={id}
                      className="sidebar-awg-chip"
                      title={id}
                      style={{
                        borderColor: `${spec?.accent || "#38bdf8"}55`,
                        color: spec?.accent || "#7dd3fc",
                      }}
                    >
                      {spec?.shortLabel || id}
                    </span>
                  );
                })}
                {checkedSubgroups.length > 2 && (
                  <span className="sidebar-awg-chip is-more">
                    +{checkedSubgroups.length - 2}
                  </span>
                )}
              </div>
            )}
            <div className="sidebar-auth-actions">
              <button
                type="button"
                className={`sidebar-auth-btn ${activeRoute === "/account" ? "active" : ""}`}
                onClick={onOpenAccount}
                data-testid="sidebar-account-btn"
              >
                Profile
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
