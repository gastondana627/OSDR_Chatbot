import { useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  LogIn,
  LogOut,
  Mail,
  RefreshCw,
  Shield,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { copyTextSafely } from "../../utils/contributorManifest.js";

const ENV_TEMPLATE_SNIPPET = `# Firebase Client Web SDK Config (.env)
VITE_FIREBASE_API_KEY=your_web_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project-id.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef123456

# Optional Admin Portal Credentials (.env, server-side only)
ADMIN_EMAILS=you@example.org
ADMIN_PASSCODE=replace_with_strong_admin_passcode`;

export default function UserLoginPortal({ onBackToChat, onNavigate }) {
  const {
    firebaseConfigured,
    firebaseConfigStatus,
    firebaseUser,
    firebaseClaims,
    backendSession,
    adminSession,
    isAdmin,
    authLoading,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    sendPasswordReset,
    resendVerificationEmail,
    refreshBackendSession,
    signOutUser,
  } = useAuth();

  const [mode, setMode] = useState("signin"); // "signin" | "signup" | "reset"
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const missingFields = firebaseConfigStatus?.missingFields || [];

  const handleCopySnippet = async () => {
    const ok = await copyTextSafely(ENV_TEMPLATE_SNIPPET);
    if (ok) {
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 2200);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    setStatusMsg("");

    if (!email.trim()) {
      setErrorMsg("Please enter your email address.");
      return;
    }

    if (mode !== "reset" && !password) {
      setErrorMsg("Please enter your password.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "signin") {
        await signInWithEmail(email, password);
        setStatusMsg("Signed in cleanly via Firebase Authentication.");
        setPassword("");
      } else if (mode === "signup") {
        await signUpWithEmail({ displayName, email, password });
        setStatusMsg("Account created! Check your inbox for an email verification link.");
        setPassword("");
      } else {
        await sendPasswordReset(email);
        setStatusMsg(`Password reset email sent to ${email.trim()}.`);
      }
    } catch (err) {
      setErrorMsg(err?.message || "Authentication request failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg("");
    setStatusMsg("");
    setSubmitting(true);
    try {
      await signInWithGoogle();
      setStatusMsg("Signed in with Google cleanly.");
    } catch (err) {
      setErrorMsg(err?.message || "Google Sign-In failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    setErrorMsg("");
    setStatusMsg("");
    setSubmitting(true);
    try {
      await resendVerificationEmail();
      setStatusMsg("Verification email sent. Refresh status after confirming the link.");
    } catch (err) {
      setErrorMsg(err?.message || "Could not resend verification email.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefreshTokenAudit = async () => {
    setErrorMsg("");
    setStatusMsg("");
    setSubmitting(true);
    try {
      await refreshBackendSession();
      setStatusMsg("Synchronized Firebase ID token & backend verification claims.");
    } catch (err) {
      setErrorMsg(err?.message || "Failed to refresh token status.");
    } finally {
      setSubmitting(false);
    }
  };

  const initials = (() => {
    const src = firebaseUser?.displayName || firebaseUser?.email || "U";
    return src.slice(0, 2).toUpperCase();
  })();

  const providerId =
    firebaseUser?.providerData?.[0]?.providerId ||
    backendSession?.user?.signInProvider ||
    "password";

  return (
    <div className="auth-page" data-testid="user-login-portal">
      <div className="auth-container">
        <div className="auth-top-bar">
          <button
            type="button"
            className="ch-back-btn"
            onClick={onBackToChat}
            data-testid="account-back-to-chat-btn"
          >
            <ArrowLeft size={14} />
            <span>Back to Research Chat</span>
          </button>

          <div className="ch-route-pills">
            <span className="ci-branch-pill">/account</span>
            <button
              type="button"
              className="auth-admin-jump-pill"
              onClick={() => onNavigate?.("/admin")}
              data-testid="account-to-admin-btn"
            >
              <Shield size={12} />
              <span>Admin Portal (/admin)</span>
            </button>
          </div>
        </div>

        {/* Setup Readiness Warning when Firebase keys are not yet in .env */}
        {!firebaseConfigured && (
          <div className="auth-setup-banner" data-testid="firebase-config-setup-banner">
            <div className="auth-setup-head">
              <div className="auth-setup-title">
                <KeyRound size={15} />
                <span>Firebase Web Config Required in <code>.env</code></span>
              </div>
              <button
                type="button"
                className={`ci-btn ci-btn-copy ${copiedSnippet ? "copied" : ""}`}
                onClick={handleCopySnippet}
              >
                {copiedSnippet ? <Check size={12} /> : <Copy size={12} />}
                <span>{copiedSnippet ? "Copied .env Template" : "Copy .env Snippet"}</span>
              </button>
            </div>
            <p className="auth-setup-copy">
              The Firebase SDK &amp; UI routes are wired, and guest research chat works right away.
              To activate live Email/Password and Google sign-in, paste your Firebase project values
              for{" "}
              <code>{missingFields.join(", ") || "VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID"}</code>{" "}
              into <code>.env</code> and restart the server.
            </p>
          </div>
        )}

        {authLoading ? (
          <div className="auth-card auth-loading-card">
            <div className="spinner" />
            <span>Checking Firebase Authentication session…</span>
          </div>
        ) : firebaseUser ? (
          /* Signed-in Researcher Profile View */
          <section className="auth-card auth-profile-card" data-testid="user-profile-panel">
            <div className="auth-profile-head">
              <div className="auth-profile-identity">
                {firebaseUser.photoURL ? (
                  <img
                    src={firebaseUser.photoURL}
                    alt={firebaseUser.displayName || "User avatar"}
                    className="auth-avatar-img"
                  />
                ) : (
                  <div className="auth-avatar-fallback" aria-hidden="true">
                    {initials}
                  </div>
                )}
                <div>
                  <div className="auth-kicker">
                    <UserCheck size={13} />
                    <span>Signed In · Firebase Authentication</span>
                  </div>
                  <h1 className="auth-title">
                    {firebaseUser.displayName || firebaseUser.email || "OSDR Researcher"}
                  </h1>
                  <div className="auth-meta-row">
                    <span>{firebaseUser.email || "No email on record"}</span>
                    <span className="auth-pill is-provider">{providerId}</span>
                    {firebaseUser.emailVerified ? (
                      <span className="auth-pill is-verified">Email Verified</span>
                    ) : (
                      <span className="auth-pill is-warn">Email Unverified</span>
                    )}
                    {isAdmin ? (
                      <span className="auth-pill is-admin">Admin Verified</span>
                    ) : (
                      <span className="auth-pill">Member</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="auth-profile-actions">
                <button
                  type="button"
                  className="ch-ghost-btn"
                  onClick={handleRefreshTokenAudit}
                  disabled={submitting}
                >
                  <RefreshCw size={12} />
                  <span>Refresh Session</span>
                </button>
                <button
                  type="button"
                  className="auth-signout-btn"
                  onClick={signOutUser}
                  data-testid="user-signout-btn"
                >
                  <LogOut size={13} />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>

            {statusMsg && <div className="auth-alert is-success">{statusMsg}</div>}
            {errorMsg && <div className="auth-alert is-error">{errorMsg}</div>}

            {!firebaseUser.emailVerified && providerId === "password" && (
              <div className="auth-verify-strip">
                <span>
                  Your email address isn&apos;t verified yet. Verify your inbox link before using
                  admin email allowlists.
                </span>
                <button
                  type="button"
                  className="ci-btn ci-btn-run"
                  onClick={handleResendVerification}
                  disabled={submitting}
                >
                  <Mail size={12} />
                  <span>Resend Verification Email</span>
                </button>
              </div>
            )}

            <div className="auth-detail-grid">
              <div className="auth-detail-tile">
                <div className="auth-detail-label">Firebase UID</div>
                <code className="auth-detail-code">{firebaseUser.uid}</code>
              </div>
              <div className="auth-detail-tile">
                <div className="auth-detail-label">Backend Verification Mode</div>
                <div className="auth-detail-value">
                  {backendSession?.user?.verificationMode || "client_sdk_active"}
                </div>
              </div>
              <div className="auth-detail-tile">
                <div className="auth-detail-label">Custom Role / Claims</div>
                <div className="auth-detail-value">
                  {isAdmin
                    ? `admin (${adminSession?.authMethod || "firebase_custom_claim"})`
                    : firebaseClaims?.role || "member"}
                </div>
              </div>
            </div>

            <div className="auth-nav-footer">
              <button
                type="button"
                className="ch-primary-btn"
                onClick={onBackToChat}
              >
                <span>Open Research Chat</span>
              </button>
              <button
                type="button"
                className="ch-secondary-btn"
                onClick={() => onNavigate?.("/contributors")}
              >
                <Users size={14} />
                <span>Contributor Hub</span>
              </button>
              <button
                type="button"
                className="ch-secondary-btn"
                onClick={() => onNavigate?.("/admin")}
              >
                <ShieldCheck size={14} />
                <span>{isAdmin ? "Open Admin Console (/admin)" : "Admin Portal (/admin)"}</span>
              </button>
            </div>
          </section>
        ) : (
          /* Signed-Out Login / Registration Card */
          <section className="auth-card" data-testid="user-auth-card">
            <div className="auth-card-header">
              <div className="auth-kicker">
                <Users size={13} />
                <span>NASA OSDR Research Workspace</span>
              </div>
              <h1 className="auth-title">
                {mode === "signup"
                  ? "Create Researcher Account"
                  : mode === "reset"
                  ? "Reset Account Password"
                  : "Sign In to OSDR ChatBot"}
              </h1>
              <p className="auth-subtitle">
                Access your workspace profile with Email/Password or Google Sign-In. Research chat
                remains open to guests at any time.
              </p>
            </div>

            <div className="auth-mode-tabs" role="tablist" aria-label="Authentication Mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signin"}
                className={`auth-mode-tab ${mode === "signin" ? "active" : ""}`}
                onClick={() => {
                  setMode("signin");
                  setErrorMsg("");
                  setStatusMsg("");
                }}
                data-testid="tab-signin"
              >
                <LogIn size={13} />
                <span>Sign In</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signup"}
                className={`auth-mode-tab ${mode === "signup" ? "active" : ""}`}
                onClick={() => {
                  setMode("signup");
                  setErrorMsg("");
                  setStatusMsg("");
                }}
                data-testid="tab-signup"
              >
                <UserPlus size={13} />
                <span>Create Account</span>
              </button>
            </div>

            {statusMsg && (
              <div className="auth-alert is-success" data-testid="auth-status-msg">
                {statusMsg}
              </div>
            )}
            {errorMsg && (
              <div className="auth-alert is-error" role="alert" data-testid="auth-error-msg">
                {errorMsg}
              </div>
            )}

            {mode !== "reset" && (
              <>
                <button
                  type="button"
                  className="auth-google-btn"
                  onClick={handleGoogleSignIn}
                  disabled={submitting || !firebaseConfigured}
                  data-testid="google-signin-btn"
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
                  <span>Continue with Google</span>
                </button>

                <div className="auth-divider">
                  <span>or continue with email</span>
                </div>
              </>
            )}

            <form className="auth-form" onSubmit={handleSubmit} noValidate>
              {mode === "signup" && (
                <div className="ch-field">
                  <label htmlFor="auth-display-name" className="ch-label">
                    Full Name
                  </label>
                  <input
                    id="auth-display-name"
                    type="text"
                    className="ch-input"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Dr. Ada Lovelace"
                    autoComplete="name"
                    data-testid="input-auth-name"
                  />
                </div>
              )}

              <div className="ch-field">
                <label htmlFor="auth-email" className="ch-label">
                  Email Address <span className="ch-req">*</span>
                </label>
                <input
                  id="auth-email"
                  type="email"
                  className="ch-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="researcher@institution.org"
                  autoComplete="email"
                  required
                  data-testid="input-auth-email"
                />
              </div>

              {mode !== "reset" && (
                <div className="ch-field">
                  <div className="auth-label-row">
                    <label htmlFor="auth-password" className="ch-label">
                      Password <span className="ch-req">*</span>
                    </label>
                    {mode === "signin" && (
                      <button
                        type="button"
                        className="auth-inline-link"
                        onClick={() => {
                          setMode("reset");
                          setErrorMsg("");
                          setStatusMsg("");
                        }}
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="auth-password-wrap">
                    <input
                      id="auth-password"
                      type={showPassword ? "text" : "password"}
                      className="ch-input"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={
                        mode === "signup" ? "At least 6 characters" : "Enter your password"
                      }
                      autoComplete={
                        mode === "signup" ? "new-password" : "current-password"
                      }
                      required
                      data-testid="input-auth-password"
                    />
                    <button
                      type="button"
                      className="auth-pw-toggle"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="ch-primary-btn auth-submit-btn"
                disabled={submitting || !firebaseConfigured}
                data-testid="auth-submit-btn"
              >
                {submitting
                  ? "Authenticating…"
                  : mode === "signup"
                  ? "Create Firebase Account"
                  : mode === "reset"
                  ? "Send Password Reset Link"
                  : "Sign In with Email"}
              </button>

              {mode === "reset" && (
                <button
                  type="button"
                  className="ch-ghost-btn"
                  onClick={() => {
                    setMode("signin");
                    setErrorMsg("");
                  }}
                >
                  Back to Sign In
                </button>
              )}
            </form>

            <div className="auth-card-foot">
              <button
                type="button"
                className="auth-inline-link"
                onClick={onBackToChat}
                data-testid="continue-guest-btn"
              >
                Continue exploring research chat as Guest →
              </button>
              <button
                type="button"
                className="auth-inline-link is-admin"
                onClick={() => onNavigate?.("/admin")}
                data-testid="goto-admin-portal-link"
              >
                Administrator Login (/admin) →
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

