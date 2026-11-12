import { useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  BellRing,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogOut,
  Radar,
  RefreshCw,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Users,
} from "lucide-react";
import {
  fetchAdminOverview,
  refreshAwgRadar,
  sendRadarWebhookTest,
  triggerRadarMonitorCheck,
  updateFirebaseAdminClaim,
} from "../../api.js";
import { useAuth } from "../../context/AuthContext.jsx";

export default function AdminPortal({ onBackToChat, onNavigate }) {
  const {
    firebaseConfigured,
    serverAuthConfig,
    firebaseUser,
    adminSession,
    getFreshIdToken,
    signInWithEmail,
    signInWithGoogle,
    verifyAdminViaFirebase,
    loginAdminDirect,
    logoutAdminOnly,
    signOutUser,
  } = useAuth();

  const [loginMethod, setLoginMethod] = useState("firebase"); // "firebase" | "server_credentials"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passcode, setPasscode] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  // Admin Console state
  const [activeTab, setActiveTab] = useState("overview"); // "overview" | "claims" | "operations"
  const [overview, setOverview] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [claimTarget, setClaimTarget] = useState("");
  const [claimGrant, setClaimGrant] = useState(true);
  const [claimStatus, setClaimStatus] = useState("");
  const [claimError, setClaimError] = useState("");
  const [radarSyncMsg, setRadarSyncMsg] = useState("");
  const [webhookTestMsg, setWebhookTestMsg] = useState("");
  const [webhookTestTone, setWebhookTestTone] = useState("success");

  const adminConfig = serverAuthConfig?.adminStatus || {};
  const noServerAdminConfigured =
    serverAuthConfig &&
    !adminConfig.adminAllowlistConfigured &&
    !adminConfig.adminPasscodeRequired &&
    !adminConfig.directAdminCredentialsConfigured &&
    !adminConfig.firebaseAdminSdkReady;

  const loadOverview = async () => {
    setLoadingOverview(true);
    setErrorMsg("");
    try {
      const token = await getFreshIdToken(false).catch(() => "");
      const data = await fetchAdminOverview(token);
      setOverview(data);
    } catch (err) {
      setErrorMsg(err?.message || "Failed to load admin overview.");
    } finally {
      setLoadingOverview(false);
    }
  };

  useEffect(() => {
    if (adminSession?.role === "admin") {
      loadOverview();
    } else {
      setOverview(null);
    }
  }, [adminSession]);

  const handleFirebaseAdminUnlock = async (e) => {
    e?.preventDefault?.();
    setErrorMsg("");
    setStatusMsg("");
    setSubmitting(true);

    try {
      if (!firebaseUser) {
        if (!email.trim() || !password) {
          throw new Error("Enter your Firebase Admin email and password (or use Google Admin Sign-In).");
        }
        await signInWithEmail(email, password);
      }
      const res = await verifyAdminViaFirebase({ passcode });
      setStatusMsg(res?.message || "Admin session verified.");
      setPassword("");
      setPasscode("");
    } catch (err) {
      setErrorMsg(err?.message || "Failed to verify Firebase admin credentials.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleAdminUnlock = async () => {
    setErrorMsg("");
    setStatusMsg("");
    setSubmitting(true);
    try {
      await signInWithGoogle();
      const res = await verifyAdminViaFirebase({ passcode });
      setStatusMsg(res?.message || "Admin session verified via Google + Firebase.");
      setPasscode("");
    } catch (err) {
      setErrorMsg(err?.message || "Google Admin Sign-In / verification failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDirectCredentialLogin = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    setStatusMsg("");

    if (!email.trim() || !password) {
      setErrorMsg("Administrator email/username and password are required.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await loginAdminDirect({ email: email.trim(), password });
      setStatusMsg(res?.message || "Signed into Administrator Console.");
      setPassword("");
    } catch (err) {
      setErrorMsg(err?.message || "Administrator credential login failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateClaim = async (e) => {
    e.preventDefault();
    setClaimError("");
    setClaimStatus("");
    if (!claimTarget.trim()) {
      setClaimError("Enter a Firebase user email address or UID.");
      return;
    }
    setSubmitting(true);
    try {
      const token = await getFreshIdToken(false).catch(() => "");
      const res = await updateFirebaseAdminClaim({
        idToken: token,
        target: claimTarget.trim(),
        grantAdmin: claimGrant,
      });
      setClaimStatus(res?.reason || "Updated Firebase admin claim.");
      setClaimTarget("");
      loadOverview();
    } catch (err) {
      setClaimError(err?.message || "Could not update Firebase custom claims.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefreshRadar = async () => {
    setRadarSyncMsg("");
    setSubmitting(true);
    try {
      const res = await refreshAwgRadar(true);
      setRadarSyncMsg(
        res?.refreshed
          ? `Live Release Radar synced cleanly (${res.osdrReleases?.length || 0} OSDR releases, ${res.leadSignals?.length || 0} AWG lead signals).`
          : `Sync completed: ${res?.reason || "using bundled radar snapshot"}`
      );
      loadOverview();
    } catch (err) {
      setRadarSyncMsg(err?.message || "Release Radar refresh encountered an error.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRun8hWebhookCheck = async () => {
    setRadarSyncMsg("");
    setWebhookTestMsg("");
    setSubmitting(true);
    try {
      const res = await triggerRadarMonitorCheck(true);
      const count = res?.newDropsCount || 0;
      setRadarSyncMsg(
        count > 0
          ? `8-hour drop check detected ${count} new item(s) and dispatched ${res?.deliveries?.length || 0} webhook alert(s).`
          : `8-hour drop check finished (${res?.reason || "up to date"}). Latest Ryan T. Scott item: ${
              res?.webhookStatus?.spotlightLead?.latestPublishedDate || "n/a"
            }.`
      );
      loadOverview();
    } catch (err) {
      setWebhookTestTone("error");
      setWebhookTestMsg(err?.message || "8-hour drop check failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestRadarWebhook = async () => {
    setWebhookTestMsg("");
    setSubmitting(true);
    try {
      const token = await getFreshIdToken(false).catch(() => "");
      const res = await sendRadarWebhookTest(token);
      if (res?.outboundConfigured) {
        const okCount = (res.deliveries || []).filter((d) => d.ok).length;
        setWebhookTestTone(okCount === (res.deliveries || []).length ? "success" : "error");
        setWebhookTestMsg(
          `Webhook test ping dispatched to ${res.targetsCount} target(s): ${okCount}/${res.deliveries?.length || 0} delivered.`
        );
      } else {
        setWebhookTestTone("success");
        setWebhookTestMsg(
          `Webhook payload & HMAC signer verified (dry-run preview). Configure RADAR_WEBHOOK_URL, DISCORD_WEBHOOK_URL, or SLACK_WEBHOOK_URL in .env for live outbound dispatch.`
        );
      }
      loadOverview();
    } catch (err) {
      setWebhookTestTone("error");
      setWebhookTestMsg(err?.message || "Webhook test ping failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page admin-page" data-testid="admin-portal-view">
      <div className="auth-container">
        <div className="auth-top-bar">
          <button
            type="button"
            className="ch-back-btn"
            onClick={onBackToChat}
            data-testid="admin-back-to-chat-btn"
          >
            <ArrowLeft size={14} />
            <span>Back to Research Chat</span>
          </button>

          <div className="ch-route-pills">
            <span className="ci-branch-pill is-admin-route">
              <Shield size={11} />
              <span>/admin</span>
            </span>
            <button
              type="button"
              className="ch-ghost-btn"
              onClick={() => onNavigate?.("/account")}
              data-testid="admin-to-account-btn"
            >
              <Users size={12} />
              <span>User Account (/account)</span>
            </button>
          </div>
        </div>

        {/* Dedicated Admin Gate vs Authenticated Admin Dashboard */}
        {adminSession?.role !== "admin" ? (
          <section className="auth-card admin-gate-card" data-testid="admin-login-card">
            <div className="auth-card-header">
              <div className="auth-kicker is-admin">
                <ShieldAlert size={13} />
                <span>Restricted Administrator Perimeter</span>
              </div>
              <h1 className="auth-title">Administrator Portal Login</h1>
              <p className="auth-subtitle">
                Separate credential gate for repository maintainers &amp; AWG moderators. All
                admin credentials, allowlists, and role claims are verified strictly server-side
                and never embedded in client code.
              </p>
            </div>

            {noServerAdminConfigured && (
              <div className="auth-setup-banner is-admin-setup" data-testid="admin-setup-notice">
                <div className="auth-setup-title">
                  <KeyRound size={15} />
                  <span>Server Admin Credentials Not Configured Yet in <code>.env</code></span>
                </div>
                <p className="auth-setup-copy">
                  Add <code>ADMIN_EMAILS</code> (comma-separated verified admin emails) and/or{" "}
                  <code>ADMIN_PASSCODE</code> (plus optional{" "}
                  <code>FIREBASE_SERVICE_ACCOUNT_JSON</code> for persistent custom claims) to your
                  server <code>.env</code>, then restart the backend.
                </p>
              </div>
            )}

            <div className="auth-mode-tabs" role="tablist" aria-label="Admin Verification Method">
              <button
                type="button"
                role="tab"
                aria-selected={loginMethod === "firebase"}
                className={`auth-mode-tab ${loginMethod === "firebase" ? "active" : ""}`}
                onClick={() => {
                  setLoginMethod("firebase");
                  setErrorMsg("");
                  setStatusMsg("");
                }}
                data-testid="admin-tab-firebase"
              >
                <ShieldCheck size={13} />
                <span>Firebase Admin + Claims</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={loginMethod === "server_credentials"}
                className={`auth-mode-tab ${loginMethod === "server_credentials" ? "active" : ""}`}
                onClick={() => {
                  setLoginMethod("server_credentials");
                  setErrorMsg("");
                  setStatusMsg("");
                }}
                data-testid="admin-tab-credentials"
              >
                <Lock size={13} />
                <span>Server Admin Credentials</span>
              </button>
            </div>

            {statusMsg && (
              <div className="auth-alert is-success" data-testid="admin-status-msg">
                {statusMsg}
              </div>
            )}
            {errorMsg && (
              <div className="auth-alert is-error" role="alert" data-testid="admin-error-msg">
                {errorMsg}
              </div>
            )}

            {loginMethod === "firebase" ? (
              <form className="auth-form" onSubmit={handleFirebaseAdminUnlock} noValidate>
                {firebaseUser ? (
                  <div className="admin-active-fb-box">
                    <div>
                      <div className="admin-active-label">Signed-In Firebase Account</div>
                      <div className="admin-active-email">
                        {firebaseUser.email || firebaseUser.uid}{" "}
                        <span className="auth-pill">
                          {firebaseUser.emailVerified ? "Verified Email" : "Unverified Email"}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ch-ghost-btn"
                      onClick={signOutUser}
                    >
                      Switch Account
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="auth-google-btn"
                      onClick={handleGoogleAdminUnlock}
                      disabled={submitting || !firebaseConfigured}
                      data-testid="admin-google-signin-btn"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          fill="#EA4335"
                          d="M12 5.04c1.9 0 3.6.66 4.94 1.94l3.7-3.7C18.4 1.19 15.44 0 12 0 7.31 0 3.26 2.69 1.28 6.61l4.31 3.35C6.61 6.91 9.09 5.04 12 5.04z"
                        />
                        <path
                          fill="#4285F4"
                          d="M23.49 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.44a5.51 5.51 0 0 1-2.39 3.61l3.71 2.88c2.17-2 3.73-4.95 3.73-8.68z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.59 14.04a7.17 7.17 0 0 1 0-4.08L1.28 6.61a12.01 12.01 0 0 0 0 10.78l4.31-3.35z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.71-2.88c-1.07.72-2.44 1.15-4.24 1.15-2.91 0-5.39-1.87-6.41-4.92L1.28 17.79C3.26 21.31 7.31 24 12 24z"
                        />
                      </svg>
                      <span>Sign In &amp; Verify Admin via Google</span>
                    </button>

                    <div className="auth-divider">
                      <span>or enter Firebase admin email &amp; password</span>
                    </div>

                    <div className="ch-field">
                      <label htmlFor="admin-fb-email" className="ch-label">
                        Admin Firebase Email <span className="ch-req">*</span>
                      </label>
                      <input
                        id="admin-fb-email"
                        type="email"
                        className="ch-input"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="admin@osdr-project.org"
                        autoComplete="username"
                        data-testid="input-admin-fb-email"
                      />
                    </div>

                    <div className="ch-field">
                      <label htmlFor="admin-fb-password" className="ch-label">
                        Account Password <span className="ch-req">*</span>
                      </label>
                      <div className="auth-password-wrap">
                        <input
                          id="admin-fb-password"
                          type={showSecret ? "text" : "password"}
                          className="ch-input"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Firebase user password"
                          autoComplete="current-password"
                          data-testid="input-admin-fb-password"
                        />
                        <button
                          type="button"
                          className="auth-pw-toggle"
                          onClick={() => setShowSecret((prev) => !prev)}
                          aria-label={showSecret ? "Hide password" : "Show password"}
                        >
                          {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                <div className="ch-field">
                  <label htmlFor="admin-passcode" className="ch-label">
                    Server Admin Passcode{" "}
                    {adminConfig.adminPasscodeRequired ? (
                      <span className="ch-req">* (Required by server)</span>
                    ) : (
                      "(Optional if custom claim / allowlist matched)"
                    )}
                  </label>
                  <div className="auth-password-wrap">
                    <input
                      id="admin-passcode"
                      type={showSecret ? "text" : "password"}
                      className="ch-input"
                      value={passcode}
                      onChange={(e) => setPasscode(e.target.value)}
                      placeholder="Enter ADMIN_PASSCODE from server .env"
                      autoComplete="off"
                      data-testid="input-admin-passcode"
                    />
                    <button
                      type="button"
                      className="auth-pw-toggle"
                      onClick={() => setShowSecret((prev) => !prev)}
                      aria-label={showSecret ? "Hide passcode" : "Show passcode"}
                    >
                      {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  className="ch-primary-btn auth-submit-btn is-admin-btn"
                  disabled={submitting || (!firebaseUser && !firebaseConfigured)}
                  data-testid="admin-verify-submit-btn"
                >
                  <ShieldCheck size={15} />
                  <span>
                    {submitting ? "Verifying Admin Session…" : "Verify & Enter Admin Console"}
                  </span>
                </button>
              </form>
            ) : (
              /* Method 2: Direct Server-Side .env Admin Credentials */
              <form className="auth-form" onSubmit={handleDirectCredentialLogin} noValidate>
                <div className="ch-field">
                  <label htmlFor="admin-direct-email" className="ch-label">
                    Admin Email or Username <span className="ch-req">*</span>
                  </label>
                  <input
                    id="admin-direct-email"
                    type="text"
                    className="ch-input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ADMIN_USERNAME or ADMIN_EMAILS entry"
                    autoComplete="username"
                    required
                    data-testid="input-admin-direct-email"
                  />
                </div>

                <div className="ch-field">
                  <label htmlFor="admin-direct-password" className="ch-label">
                    Admin Password / Passcode <span className="ch-req">*</span>
                  </label>
                  <div className="auth-password-wrap">
                    <input
                      id="admin-direct-password"
                      type={showSecret ? "text" : "password"}
                      className="ch-input"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Server ADMIN_PASSCODE"
                      autoComplete="current-password"
                      required
                      data-testid="input-admin-direct-password"
                    />
                    <button
                      type="button"
                      className="auth-pw-toggle"
                      onClick={() => setShowSecret((prev) => !prev)}
                      aria-label={showSecret ? "Hide password" : "Show password"}
                    >
                      {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  className="ch-primary-btn auth-submit-btn is-admin-btn"
                  disabled={submitting}
                  data-testid="admin-direct-submit-btn"
                >
                  <Lock size={15} />
                  <span>{submitting ? "Authenticating…" : "Sign In with Admin Credentials"}</span>
                </button>
              </form>
            )}
          </section>
        ) : (
          /* Authenticated Administrator Dashboard Console */
          <section className="auth-card admin-console-card" data-testid="admin-console-dashboard">
            <div className="auth-profile-head">
              <div>
                <div className="auth-kicker is-admin">
                  <ShieldCheck size={14} />
                  <span>Verified Administrator Console</span>
                </div>
                <h1 className="auth-title">
                  {adminSession.displayName || adminSession.email || adminSession.uid}
                </h1>
                <div className="auth-meta-row">
                  <span>UID: <code>{adminSession.uid}</code></span>
                  <span className="auth-pill is-admin">{adminSession.authMethod}</span>
                </div>
              </div>

              <div className="auth-profile-actions">
                <button
                  type="button"
                  className="ch-ghost-btn"
                  onClick={loadOverview}
                  disabled={loadingOverview}
                >
                  <RefreshCw size={12} />
                  <span>Refresh Telemetry</span>
                </button>
                <button
                  type="button"
                  className="ch-ghost-btn"
                  onClick={logoutAdminOnly}
                  data-testid="admin-lock-session-btn"
                >
                  <Lock size={12} />
                  <span>Lock Admin</span>
                </button>
                <button
                  type="button"
                  className="auth-signout-btn"
                  onClick={signOutUser}
                  data-testid="admin-signout-all-btn"
                >
                  <LogOut size={13} />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>

            {statusMsg && <div className="auth-alert is-success">{statusMsg}</div>}
            {errorMsg && <div className="auth-alert is-error">{errorMsg}</div>}

            <div className="auth-mode-tabs" role="tablist" aria-label="Admin Console Sections">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "overview"}
                className={`auth-mode-tab ${activeTab === "overview" ? "active" : ""}`}
                onClick={() => setActiveTab("overview")}
                data-testid="admin-console-tab-overview"
              >
                <Activity size={13} />
                <span>System &amp; Auth Health</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "claims"}
                className={`auth-mode-tab ${activeTab === "claims" ? "active" : ""}`}
                onClick={() => setActiveTab("claims")}
                data-testid="admin-console-tab-claims"
              >
                <UserCheck size={13} />
                <span>Firebase Admin Claims</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "operations"}
                className={`auth-mode-tab ${activeTab === "operations" ? "active" : ""}`}
                onClick={() => setActiveTab("operations")}
                data-testid="admin-console-tab-ops"
              >
                <Radar size={13} />
                <span>Radar &amp; Audit Ops</span>
              </button>
            </div>

            {activeTab === "overview" && (
              <div className="admin-tab-body" data-testid="admin-overview-panel">
                {loadingOverview && !overview ? (
                  <div className="ci-loading-state">
                    <div className="spinner" />
                    <span>Loading live server diagnostics…</span>
                  </div>
                ) : (
                  <>
                    <div className="admin-stat-grid">
                      <div className="admin-stat-card">
                        <div className="admin-stat-label">Firebase Auth Config</div>
                        <div className="admin-stat-val">
                          {overview?.authDiagnostics?.firebaseClientConfigured
                            ? "Configured"
                            : "Awaiting .env Keys"}
                        </div>
                        <div className="admin-stat-sub">
                          Admin SDK:{" "}
                          {overview?.authDiagnostics?.firebaseAdminSdkReady
                            ? "Service Account Active"
                            : "Public X.509 / Cookie Mode"}
                        </div>
                      </div>

                      <div className="admin-stat-card">
                        <div className="admin-stat-label">Admin Gate Rules</div>
                        <div className="admin-stat-val">
                          {overview?.authDiagnostics?.adminAllowlistCount || 0} Allowlist Entries
                        </div>
                        <div className="admin-stat-sub">
                          Passcode Armed:{" "}
                          {overview?.authDiagnostics?.adminPasscodeConfigured ? "Yes" : "No"}
                        </div>
                      </div>

                      <div className="admin-stat-card">
                        <div className="admin-stat-label">OSDR Knowledge Index</div>
                        <div className="admin-stat-val">
                          {overview?.osdrDiagnostics?.dataSources?.local_curated_mapping?.count || 55} Curated Studies
                        </div>
                        <div className="admin-stat-sub">
                          Live Mode: {overview?.osdrDiagnostics?.sourceMode || "local_curated_mapping"}
                        </div>
                      </div>

                      <div className="admin-stat-card">
                        <div className="admin-stat-label">Community &amp; Radar</div>
                        <div className="admin-stat-val">
                          {overview?.communitySummary?.contributorsCount || 2} Featured Twins
                        </div>
                        <div className="admin-stat-sub">
                          Radar: {overview?.radarSummary?.osdrReleasesCount || 0} releases ·{" "}
                          {overview?.radarSummary?.leadSignalsCount || 0} lead signals
                        </div>
                      </div>
                    </div>

                    {overview?.communitySummary?.contributors?.length > 0 && (
                      <div className="admin-list-panel">
                        <div className="ci-box-label">Active Community Showcase Models</div>
                        <div className="admin-contrib-list">
                          {overview.communitySummary.contributors.map((c) => (
                            <div key={c.id} className="admin-contrib-row">
                              <div>
                                <strong>{c.title}</strong> · {c.author}
                                <div className="admin-stat-sub">{c.domain}</div>
                              </div>
                              <button
                                type="button"
                                className="ch-ghost-btn"
                                onClick={() => onNavigate?.("/contributors")}
                              >
                                Inspect in Hub
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {activeTab === "claims" && (
              <div className="admin-tab-body" data-testid="admin-claims-panel">
                <p className="auth-subtitle">
                  Assign or revoke Firebase Authentication custom claims (<code>admin: true</code>,{" "}
                  <code>role: &quot;admin&quot;</code>) for a teammate by email or UID. Requires{" "}
                  <code>FIREBASE_SERVICE_ACCOUNT_JSON</code> (or{" "}
                  <code>FIREBASE_CLIENT_EMAIL</code> + <code>FIREBASE_PRIVATE_KEY</code>) on the
                  backend.
                </p>

                {!overview?.authDiagnostics?.firebaseAdminSdkReady && (
                  <div className="auth-setup-banner is-admin-setup">
                    <div className="auth-setup-title">
                      <KeyRound size={14} />
                      <span>Firebase Admin Service Account Pending</span>
                    </div>
                    <p className="auth-setup-copy">
                      Right now admin verification uses allowlists / passcodes cleanly. Attach{" "}
                      <code>FIREBASE_SERVICE_ACCOUNT_JSON</code> in <code>.env</code> to mutate
                      persistent Firebase user claims remotely from this panel.
                    </p>
                  </div>
                )}

                <form className="auth-form" onSubmit={handleUpdateClaim}>
                  <div className="ch-form-grid">
                    <div className="ch-field">
                      <label htmlFor="claim-target-input" className="ch-label">
                        User Email or Firebase UID
                      </label>
                      <input
                        id="claim-target-input"
                        type="text"
                        className="ch-input"
                        value={claimTarget}
                        onChange={(e) => setClaimTarget(e.target.value)}
                        placeholder="collaborator@nasa-awg.org or uid..."
                        data-testid="input-claim-target"
                      />
                    </div>
                    <div className="ch-field">
                      <label htmlFor="claim-action-select" className="ch-label">
                        Role Action
                      </label>
                      <select
                        id="claim-action-select"
                        className="ch-input ch-select"
                        value={claimGrant ? "grant" : "revoke"}
                        onChange={(e) => setClaimGrant(e.target.value === "grant")}
                      >
                        <option value="grant">Grant admin: true custom claim</option>
                        <option value="revoke">Revoke admin custom claim</option>
                      </select>
                    </div>
                  </div>

                  {claimStatus && <div className="auth-alert is-success">{claimStatus}</div>}
                  {claimError && <div className="auth-alert is-error">{claimError}</div>}

                  <button
                    type="submit"
                    className="ch-primary-btn is-admin-btn"
                    disabled={submitting}
                    data-testid="submit-claim-update-btn"
                  >
                    <CheckCircle2 size={14} />
                    <span>{submitting ? "Updating Claims…" : "Update Firebase Custom Claim"}</span>
                  </button>
                </form>
              </div>
            )}

            {activeTab === "operations" && (
              <div className="admin-tab-body" data-testid="admin-ops-panel">
                <div className="admin-ops-bar">
                  <button
                    type="button"
                    className="ch-secondary-btn"
                    onClick={handleRefreshRadar}
                    disabled={submitting}
                  >
                    <Radar size={14} />
                    <span>Trigger Live Release Radar Sync</span>
                  </button>
                  <button
                    type="button"
                    className="ch-ghost-btn"
                    onClick={handleRun8hWebhookCheck}
                    disabled={submitting}
                    data-testid="admin-run-8h-check-btn"
                  >
                    <BellRing size={13} />
                    <span>Run 8h Drop Check</span>
                  </button>
                  <button
                    type="button"
                    className="ch-ghost-btn"
                    onClick={handleTestRadarWebhook}
                    disabled={submitting}
                    data-testid="admin-test-webhook-btn"
                  >
                    <Send size={13} />
                    <span>Send Webhook Test Ping</span>
                  </button>
                  <button
                    type="button"
                    className="ch-ghost-btn"
                    onClick={() => onNavigate?.("/contributors")}
                  >
                    <Database size={13} />
                    <span>Open Contributor Hub</span>
                  </button>
                </div>

                {radarSyncMsg && <div className="auth-alert is-success">{radarSyncMsg}</div>}
                {webhookTestMsg && (
                  <div className={`auth-alert ${webhookTestTone === "error" ? "is-error" : "is-success"}`}>
                    {webhookTestMsg}
                  </div>
                )}

                {overview?.radarSummary?.webhookStatus && (() => {
                  const ws = overview.radarSummary.webhookStatus;
                  return (
                    <div className="admin-list-panel admin-webhook-panel" data-testid="admin-webhook-panel">
                      <div className="admin-webhook-head">
                        <div className="ci-box-label">
                          8-Hour Lead Drop Monitor &amp; Webhook Dispatch (Ryan T. Scott Spotlight)
                        </div>
                        <span className="auth-pill">
                          Every {ws.intervalHours}h · {ws.schedulerRunning ? "Daemon Running" : "8h GH Action"}
                        </span>
                      </div>

                      <div className="admin-stat-grid">
                        <div className="admin-stat-card">
                          <div className="admin-stat-label">Ryan T. Scott Spotlight</div>
                          <div className="admin-stat-val">
                            {ws.spotlightLead?.trackedSignalsCount || 0} Scoped Releases
                          </div>
                          <div className="admin-stat-sub">
                            Latest indexed date: {ws.spotlightLead?.latestPublishedDate || "—"}
                          </div>
                        </div>
                        <div className="admin-stat-card">
                          <div className="admin-stat-label">Webhook Targets &amp; HMAC</div>
                          <div className="admin-stat-val">
                            {ws.configuredTargets?.length || 0} Outbound Target(s)
                          </div>
                          <div className="admin-stat-sub">
                            HMAC Secret Armed: {ws.secretArmed ? "Yes (X-OSDR-Signature-256)" : "No (.env RADAR_WEBHOOK_SECRET)"}
                          </div>
                        </div>
                      </div>

                      <div className="admin-webhook-meta">
                        Checks run: {ws.totalChecksRun} · Last:{" "}
                        {ws.lastCheckAt ? ws.lastCheckAt.replace("T", " ").slice(0, 19) + " UTC" : "Not yet run"} · Next:{" "}
                        {ws.nextScheduledCheckAt ? ws.nextScheduledCheckAt.replace("T", " ").slice(0, 19) + " UTC" : "On boot / 8h cron"}
                      </div>

                      {ws.configuredTargets?.length > 0 ? (
                        <div className="admin-webhook-sublist">
                          {ws.configuredTargets.map((t, i) => (
                            <div key={`${t.host}-${i}`} className="admin-contrib-row">
                              <span>
                                <code>{t.type}</code> · {t.host}
                              </span>
                              <span className="auth-pill">Armed</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="auth-subtitle">
                          Inbound endpoint ready at <code>POST /api/awg/radar/webhook</code>. Add{" "}
                          <code>RADAR_WEBHOOK_URL</code>, <code>DISCORD_WEBHOOK_URL</code>, or{" "}
                          <code>SLACK_WEBHOOK_URL</code> in server <code>.env</code> to auto-push 8h drops.
                        </p>
                      )}

                      {ws.recentDetectedDrops?.length > 0 && (
                        <div className="admin-webhook-sublist">
                          <div className="ci-box-label">Recent Detected Drops ({ws.recentDetectedDrops.length})</div>
                          {ws.recentDetectedDrops.slice(0, 5).map((d) => (
                            <div key={d.id} className="admin-contrib-row">
                              <span>
                                <strong>{d.leadName}</strong> ({d.publishedDate}) · {d.title}
                              </span>
                              <span className="auth-pill">{d.sourcePlatform}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {ws.recentDeliveries?.length > 0 && (
                        <div className="admin-webhook-sublist">
                          <div className="ci-box-label">Recent Outbound Deliveries ({ws.recentDeliveries.length})</div>
                          {ws.recentDeliveries.slice(0, 5).map((dlv) => (
                            <div key={dlv.deliveryId} className="admin-contrib-row">
                              <span>
                                <code>{dlv.event}</code> → {dlv.targetHost} ({dlv.latencyMs}ms)
                              </span>
                              <span className="auth-pill">
                                {dlv.ok ? `HTTP ${dlv.statusCode}` : dlv.error || "Failed"}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="admin-list-panel">
                  <div className="ci-box-label">
                    Recent Session Media Audit Entries ({overview?.mediaAuditSummary?.totalEntries || 0})
                  </div>
                  {overview?.mediaAuditSummary?.recentEntries?.length ? (
                    <div className="admin-contrib-list">
                      {overview.mediaAuditSummary.recentEntries.map((m) => (
                        <div key={m.requestId} className="admin-contrib-row">
                          <span>
                            <code>{m.mode}</code> · {m.provider}
                          </span>
                          <span className="auth-pill">{m.status}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="auth-subtitle">
                      No media generation audit records in this server runtime yet.
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
