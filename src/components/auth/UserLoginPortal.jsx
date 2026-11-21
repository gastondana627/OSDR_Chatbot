import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Compass,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LogIn,
  LogOut,
  Mail,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { copyTextSafely, downloadJsonFile } from "../../utils/contributorManifest.js";
import {
  AVATAR_ACCENTS,
  AWG_PROFILE_SUBGROUPS,
  RESEARCH_FOCUS_OPTIONS,
  computeProfileInitials,
  exportResearcherProfilePayload,
  getAvatarAccentSpec,
  getPersonalizedPresetsForProfile,
  getSubgroupSpec,
  normalizeOrcid,
  validateOrcidFormat,
} from "../../utils/researcherProfile.js";
import ResearcherProfileWalkthrough from "./ResearcherProfileWalkthrough.jsx";

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

const MODEL_PREFERENCE_OPTIONS = [
  { value: "", label: "Default (Auto-selected Free Frontier Model)" },
  { value: "gemini-4-argon", label: "Gemini 4 Argon (Reasoning · 1M)" },
  { value: "gemini-3.7-flash", label: "Gemini 3.7 Flash (Balanced · Free Tier)" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Fast · Free Tier)" },
  { value: "openrouter/free", label: "OpenRouter Free Auto-Router ($0 Live)" },
  { value: "google/gemma-4-31b-it:free", label: "Gemma 4 31B Instruct (OpenRouter · Free)" },
  { value: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "NVIDIA Nemotron 3 Ultra 550B (OpenRouter · Free)" },
  { value: "groq/openai/gpt-oss-120b", label: "Groq GPT-OSS 120B (LPU · Free)" },
  { value: "groq/llama-3.1-8b-instant", label: "Groq Llama 3.1 8B (LPU · Instant Free)" },
];

export default function UserLoginPortal({ onBackToChat, onNavigate, onRunPrompt }) {
  const {
    firebaseConfigured,
    firebaseConfigStatus,
    firebaseUser,
    firebaseClaims,
    backendSession,
    adminSession,
    researcherProfile,
    needsOnboarding,
    isAdmin,
    authLoading,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    sendPasswordReset,
    resendVerificationEmail,
    refreshBackendSession,
    signOutUser,
    saveProfile,
    completeOnboarding,
    dismissOnboarding,
    resetProfile,
    importProfileJson,
  } = useAuth();

  const instanceId = useId();
  const [mode, setMode] = useState("signin"); // "signin" | "signup" | "reset"
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Walkthrough & custom profile editor state
  const [manualWalkthroughOpen, setManualWalkthroughOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState(null);
  const [profileDirty, setProfileDirty] = useState(false);
  const [orcidError, setOrcidError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const importFileRef = useRef(null);
  const deleteDialogRef = useRef(null);
  const orcidInputRef = useRef(null);

  useEffect(() => {
    if (researcherProfile) {
      setProfileDraft({
        displayName: researcherProfile.displayName || "",
        affiliation: researcherProfile.affiliation || "",
        roleTitle: researcherProfile.roleTitle || "",
        orcid: researcherProfile.orcid || "",
        forumHandle: researcherProfile.forumHandle || "",
        bio: researcherProfile.bio || "",
        avatarAccent: researcherProfile.avatarAccent || "cyan",
        avatarBadge: researcherProfile.avatarBadge || "",
        awgSubgroups: Array.isArray(researcherProfile.awgSubgroups)
          ? researcherProfile.awgSubgroups
          : [],
        researchFocus: researcherProfile.researchFocus || "multi-omics",
        preferredModel: researcherProfile.preferredModel || "",
        defaultAwgMode: Boolean(researcherProfile.defaultAwgMode),
      });
      setProfileDirty(false);
      setOrcidError("");
    } else {
      setProfileDraft(null);
      setProfileDirty(false);
    }
  }, [researcherProfile]);

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

  const updateDraftField = (key, value) => {
    setProfileDraft((prev) => ({ ...(prev || {}), [key]: value }));
    setProfileDirty(true);
    if (key === "orcid" && orcidError) {
      setOrcidError("");
    }
  };

  const toggleDraftSubgroup = (subgroupId) => {
    setProfileDraft((prev) => {
      const current = new Set(prev?.awgSubgroups || []);
      if (current.has(subgroupId)) {
        current.delete(subgroupId);
      } else {
        current.add(subgroupId);
      }
      return { ...(prev || {}), awgSubgroups: Array.from(current) };
    });
    setProfileDirty(true);
  };

  const handleSaveProfileForm = async (e) => {
    e?.preventDefault?.();
    if (!profileDraft) return;
    setErrorMsg("");
    setStatusMsg("");

    const orcidCheck = validateOrcidFormat(profileDraft.orcid);
    if (!orcidCheck.valid) {
      setOrcidError(orcidCheck.error);
      orcidInputRef.current?.focus();
      return;
    }

    setSavingProfile(true);
    try {
      await saveProfile({
        ...profileDraft,
        orcid: normalizeOrcid(profileDraft.orcid),
        onboardingCompleted: true,
        onboardingDismissed: false,
      });
      setProfileDirty(false);
      setStatusMsg(
        `Saved your AWG researcher profile (${profileDraft.awgSubgroups.length} subgroup${
          profileDraft.awgSubgroups.length === 1 ? "" : "s"
        } checked).`
      );
    } catch (err) {
      setErrorMsg(err?.message || "Could not save researcher profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleWalkthroughComplete = async (draftPayload) => {
    setErrorMsg("");
    setStatusMsg("");
    try {
      const saved = await completeOnboarding(draftPayload);
      setManualWalkthroughOpen(false);
      setStatusMsg(
        `Welcome aboard! Saved your custom AWG profile with ${
          saved?.awgSubgroups?.length || 0
        } checked subgroup${saved?.awgSubgroups?.length === 1 ? "" : "s"}.`
      );
    } catch (err) {
      setErrorMsg(err?.message || "Could not complete profile walkthrough.");
    }
  };

  const handleWalkthroughSkip = () => {
    if (needsOnboarding) {
      dismissOnboarding();
    }
    setManualWalkthroughOpen(false);
  };

  const handleExportProfile = () => {
    if (!researcherProfile) return;
    const payload = exportResearcherProfilePayload(researcherProfile);
    const slug = (researcherProfile.displayName || "osdr-researcher")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32);
    downloadJsonFile(`osdr-awg-profile-${slug || "researcher"}.json`, payload);
    setStatusMsg("Exported your AWG researcher profile JSON for backup or another workstation.");
  };

  const handleImportProfileFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErrorMsg("");
    setStatusMsg("");
    try {
      const text = await file.text();
      const imported = await importProfileJson(text);
      setStatusMsg(
        `Imported AWG profile for ${imported?.displayName || "your account"} (${
          imported?.awgSubgroups?.length || 0
        } subgroups).`
      );
    } catch (err) {
      setErrorMsg(err?.message || "Could not import profile JSON file.");
    }
  };

  const openDeleteConfirmDialog = () => {
    const dlg = deleteDialogRef.current;
    if (dlg && typeof dlg.showModal === "function") {
      dlg.returnValue = "";
      dlg.showModal();
    }
  };

  const handleDeleteDialogClose = () => {
    const dlg = deleteDialogRef.current;
    if (!dlg) return;
    const choice = dlg.returnValue;
    // Reset returnValue so stale values never leak on subsequent Esc dismisses
    dlg.returnValue = "";
    if (choice === "delete") {
      resetProfile();
      setManualWalkthroughOpen(false);
      setStatusMsg("Deleted local AWG profile data from this browser.");
    }
  };

  const activeProfile = profileDraft || researcherProfile;
  const accentSpec = getAvatarAccentSpec(activeProfile?.avatarAccent);
  const initials = computeProfileInitials(activeProfile, firebaseUser);
  const checkedSubgroups = Array.isArray(researcherProfile?.awgSubgroups)
    ? researcherProfile.awgSubgroups
    : [];
  const personalizedPresets = getPersonalizedPresetsForProfile(researcherProfile);
  const matchedPresets = personalizedPresets.filter((p) => p.isMatched);

  const providerId =
    firebaseUser?.providerData?.[0]?.providerId ||
    backendSession?.user?.signInProvider ||
    "password";

  const showWalkthrough = Boolean(firebaseUser && (manualWalkthroughOpen || needsOnboarding));
  const deleteTitleId = `${instanceId}-delete-dialog-title`;

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
                <span>
                  Firebase Web Config Required in <code>.env</code>
                </span>
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
              <code>
                {missingFields.join(", ") || "VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID"}
              </code>{" "}
              into <code>.env</code> and restart the server.
            </p>
          </div>
        )}

        {authLoading ? (
          <div className="auth-card auth-loading-card">
            <div className="spinner" />
            <span>Checking Firebase Authentication session…</span>
          </div>
        ) : showWalkthrough ? (
          /* Optional 3-Step First-Login / Guided AWG Profile Setup Walkthrough */
          <ResearcherProfileWalkthrough
            profile={researcherProfile}
            firebaseUser={firebaseUser}
            isFirstTime={needsOnboarding && !manualWalkthroughOpen}
            onComplete={handleWalkthroughComplete}
            onSkip={handleWalkthroughSkip}
          />
        ) : firebaseUser ? (
          /* Signed-in Custom AWG Researcher Profile View */
          <section className="auth-card auth-profile-card" data-testid="user-profile-panel">
            <div className="auth-profile-head">
              <div className="auth-profile-identity">
                {firebaseUser.photoURL && !activeProfile?.avatarBadge ? (
                  <img
                    src={firebaseUser.photoURL}
                    alt={activeProfile?.displayName || firebaseUser.displayName || "User avatar"}
                    className="auth-avatar-img"
                    style={{ boxShadow: `0 0 0 2px ${accentSpec.ring}88` }}
                  />
                ) : (
                  <div
                    className="awg-profile-avatar-circle"
                    style={{
                      background: accentSpec.bg,
                      boxShadow: `0 0 0 2px ${accentSpec.ring}66`,
                    }}
                    aria-hidden="true"
                  >
                    {initials}
                  </div>
                )}
                <div>
                  <div className="auth-kicker">
                    <UserCheck size={13} />
                    <span>AWG Researcher Profile · Local per-UID</span>
                  </div>
                  <h1 className="auth-title">
                    {researcherProfile?.displayName ||
                      firebaseUser.displayName ||
                      firebaseUser.email ||
                      "OSDR Researcher"}
                  </h1>
                  {(researcherProfile?.roleTitle || researcherProfile?.affiliation) && (
                    <div className="awg-profile-org-line">
                      {[researcherProfile.roleTitle, researcherProfile.affiliation]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
                  <div className="auth-meta-row">
                    <span>{firebaseUser.email || "No email on record"}</span>
                    {researcherProfile?.forumHandle && (
                      <span className="auth-pill is-handle">{researcherProfile.forumHandle}</span>
                    )}
                    {researcherProfile?.orcid && (
                      <a
                        href={`https://orcid.org/${researcherProfile.orcid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="auth-pill is-orcid"
                      >
                        <span>ORCID {researcherProfile.orcid}</span>
                        <ExternalLink size={10} />
                      </a>
                    )}
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
                  onClick={() => setManualWalkthroughOpen(true)}
                  data-testid="launch-walkthrough-btn"
                >
                  <Compass size={12} />
                  <span>Guided Setup</span>
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

            {/* Checked AWG Subgroup Chips Summary */}
            <div className="awg-profile-badges-bar" data-testid="profile-checked-subgroups-bar">
              {checkedSubgroups.length > 0 ? (
                <>
                  <span className="awg-badges-label">Your AWG Subgroups:</span>
                  {checkedSubgroups.map((id) => {
                    const spec = getSubgroupSpec(id);
                    return (
                      <span
                        key={id}
                        className="awg-checked-chip"
                        style={{
                          borderColor: `${spec?.accent || "#38bdf8"}66`,
                          color: spec?.accent || "#7dd3fc",
                          background: `${spec?.accent || "#38bdf8"}18`,
                        }}
                      >
                        <Check size={11} />
                        <span>{id}</span>
                      </span>
                    );
                  })}
                </>
              ) : (
                <span className="awg-badges-empty">
                  No AWG subgroups checked off yet — pick your Working Groups below or click{" "}
                  <strong>Guided Setup</strong> to personalize presets &amp; Contributor Hub
                  defaults.
                </span>
              )}
            </div>

            {researcherProfile?.bio && (
              <p className="awg-profile-bio-quote">{researcherProfile.bio}</p>
            )}

            {statusMsg && (
              <div className="auth-alert is-success" role="status" aria-live="polite">
                {statusMsg}
              </div>
            )}
            {errorMsg && (
              <div className="auth-alert is-error" role="alert">
                {errorMsg}
              </div>
            )}

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

            {/* Tailored Quick-Launch Presets when AWG Subgroups are Checked */}
            {matchedPresets.length > 0 && onRunPrompt && (
              <div className="awg-profile-tailored-box" data-testid="profile-tailored-presets">
                <div className="awg-profile-section-head">
                  <Sparkles size={13} />
                  <span>Recommended 1-Click Presets for Your AWG Subgroups</span>
                </div>
                <div className="awg-tailored-preset-row">
                  {matchedPresets.slice(0, 3).map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="awg-tailored-preset-btn"
                      onClick={() => onRunPrompt(preset.command)}
                    >
                      <span>{preset.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Custom Researcher Profile & AWG Subgroup Checklist Editor */}
            {profileDraft && (
              <form
                className="awg-profile-editor-form"
                onSubmit={handleSaveProfileForm}
                aria-labelledby={`${instanceId}-editor-heading`}
                noValidate
                data-testid="custom-profile-form"
              >
                <div className="awg-editor-header-row">
                  <div>
                    <h2 className="awg-editor-title" id={`${instanceId}-editor-heading`}>
                      AWG Subgroup Checklist &amp; Custom Profile
                    </h2>
                    <p className="awg-editor-subtitle">
                      Check off your Analysis Working Groups and researcher details. Saved locally
                      under your Firebase UID (zero server database storage).
                    </p>
                  </div>
                  {profileDirty && (
                    <span className="awg-unsaved-pill" role="status">
                      Unsaved changes
                    </span>
                  )}
                </div>

                <fieldset className="awg-fieldset">
                  <legend className="awg-legend">
                    Check Off Your NASA OSDR AWG Subgroups ({profileDraft.awgSubgroups.length}{" "}
                    selected)
                  </legend>
                  <div className="awg-profile-subgroup-grid">
                    {AWG_PROFILE_SUBGROUPS.map((group) => {
                      const checked = profileDraft.awgSubgroups.includes(group.id);
                      const slug = group.shortLabel.toLowerCase().replace(/[^a-z0-9]/g, "");
                      const inputId = `${instanceId}-profile-sg-${slug}`;
                      return (
                        <label
                          key={group.id}
                          htmlFor={inputId}
                          className={`awg-profile-subgroup-card ${checked ? "is-checked" : ""}`}
                          style={{ "--sg-accent": group.accent }}
                          data-testid={`profile-subgroup-${slug}`}
                        >
                          <input
                            id={inputId}
                            type="checkbox"
                            name="awgSubgroups"
                            value={group.id}
                            checked={checked}
                            onChange={() => toggleDraftSubgroup(group.id)}
                            className="awg-profile-checkbox"
                          />
                          <span className="awg-sg-content">
                            <span className="awg-sg-title-row">
                              <span className="awg-sg-title">{group.title}</span>
                              <span className="awg-sg-badge">{group.shortLabel}</span>
                            </span>
                            <span className="awg-sg-desc">{group.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="awg-profile-form-grid">
                  <div className="ch-field">
                    <label htmlFor={`${instanceId}-ed-name`} className="ch-label">
                      Display Name
                    </label>
                    <input
                      id={`${instanceId}-ed-name`}
                      name="displayName"
                      type="text"
                      className="ch-input awg-profile-input"
                      value={profileDraft.displayName}
                      onChange={(e) => updateDraftField("displayName", e.target.value)}
                      placeholder="Dr. Ada Lovelace"
                      autoComplete="name"
                      maxLength={80}
                    />
                  </div>

                  <div className="ch-field">
                    <label htmlFor={`${instanceId}-ed-aff`} className="ch-label">
                      Institution / Affiliation
                    </label>
                    <input
                      id={`${instanceId}-ed-aff`}
                      name="affiliation"
                      type="text"
                      className="ch-input awg-profile-input"
                      value={profileDraft.affiliation}
                      onChange={(e) => updateDraftField("affiliation", e.target.value)}
                      placeholder="NASA Ames / University Lab"
                      autoComplete="organization"
                      maxLength={120}
                    />
                  </div>

                  <div className="ch-field">
                    <label htmlFor={`${instanceId}-ed-role`} className="ch-label">
                      Role / Title
                    </label>
                    <input
                      id={`${instanceId}-ed-role`}
                      name="roleTitle"
                      type="text"
                      className="ch-input awg-profile-input"
                      value={profileDraft.roleTitle}
                      onChange={(e) => updateDraftField("roleTitle", e.target.value)}
                      placeholder="AWG Member, PI, Postdoc, Bioinformatician"
                      autoComplete="organization-title"
                      maxLength={80}
                    />
                  </div>

                  <div className="ch-field">
                    <label htmlFor={`${instanceId}-ed-handle`} className="ch-label">
                      AWG Forum / GitHub Handle
                    </label>
                    <input
                      id={`${instanceId}-ed-handle`}
                      name="forumHandle"
                      type="text"
                      className="ch-input awg-profile-input"
                      value={profileDraft.forumHandle}
                      onChange={(e) => updateDraftField("forumHandle", e.target.value)}
                      placeholder="@researcher_handle"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      maxLength={48}
                    />
                  </div>

                  <div className="ch-field">
                    <label htmlFor={`${instanceId}-ed-orcid`} className="ch-label">
                      ORCID iD
                    </label>
                    <input
                      ref={orcidInputRef}
                      id={`${instanceId}-ed-orcid`}
                      name="orcid"
                      type="text"
                      className="ch-input awg-profile-input"
                      value={profileDraft.orcid}
                      onChange={(e) => updateDraftField("orcid", e.target.value)}
                      onBlur={() => {
                        if (!profileDraft.orcid.trim()) {
                          setOrcidError("");
                          return;
                        }
                        const res = validateOrcidFormat(profileDraft.orcid);
                        if (!res.valid) setOrcidError(res.error);
                        else {
                          setOrcidError("");
                          if (res.normalized !== profileDraft.orcid) {
                            updateDraftField("orcid", res.normalized);
                          }
                        }
                      }}
                      placeholder="0000-0002-1825-0097"
                      aria-invalid={orcidError ? "true" : undefined}
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      maxLength={40}
                    />
                    {orcidError && (
                      <span className="awg-field-error" role="alert">
                        {orcidError}
                      </span>
                    )}
                  </div>

                  <div className="ch-field">
                    <label htmlFor={`${instanceId}-ed-model`} className="ch-label">
                      Preferred Free Model Family
                    </label>
                    <select
                      id={`${instanceId}-ed-model`}
                      name="preferredModel"
                      className="ch-input awg-profile-input"
                      value={profileDraft.preferredModel}
                      onChange={(e) => updateDraftField("preferredModel", e.target.value)}
                    >
                      {MODEL_PREFERENCE_OPTIONS.map((opt) => (
                        <option key={opt.value || "default"} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="ch-field">
                    <label htmlFor={`${instanceId}-ed-focus`} className="ch-label">
                      Primary Research Focus
                    </label>
                    <select
                      id={`${instanceId}-ed-focus`}
                      name="researchFocus"
                      className="ch-input awg-profile-input"
                      value={profileDraft.researchFocus}
                      onChange={(e) => updateDraftField("researchFocus", e.target.value)}
                    >
                      {RESEARCH_FOCUS_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="ch-field">
                    <label htmlFor={`${instanceId}-ed-badge`} className="ch-label">
                      Custom Avatar Initials (Max 3)
                    </label>
                    <input
                      id={`${instanceId}-ed-badge`}
                      name="avatarBadge"
                      type="text"
                      className="ch-input awg-profile-input"
                      value={profileDraft.avatarBadge}
                      onChange={(e) =>
                        updateDraftField("avatarBadge", e.target.value.toUpperCase().slice(0, 3))
                      }
                      placeholder={initials}
                      autoCorrect="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={3}
                    />
                  </div>
                </div>

                <div className="ch-field">
                  <label htmlFor={`${instanceId}-ed-bio`} className="ch-label">
                    Short Research Bio / Current Study Focus
                  </label>
                  <input
                    id={`${instanceId}-ed-bio`}
                    name="bio"
                    type="text"
                    className="ch-input awg-profile-input"
                    value={profileDraft.bio}
                    onChange={(e) => updateDraftField("bio", e.target.value)}
                    placeholder="e.g., Spaceflight retinal transcriptomics & Rodent Research cross-mission integration"
                    maxLength={260}
                  />
                </div>

                <fieldset className="awg-fieldset">
                  <legend className="awg-legend">Avatar Accent Theme</legend>
                  <div className="awg-swatch-row">
                    {AVATAR_ACCENTS.map((sw) => (
                      <label
                        key={sw.id}
                        className={`awg-swatch-option ${
                          profileDraft.avatarAccent === sw.id ? "is-selected" : ""
                        }`}
                      >
                        <input
                          type="radio"
                          name="profileAvatarAccent"
                          value={sw.id}
                          checked={profileDraft.avatarAccent === sw.id}
                          onChange={() => updateDraftField("avatarAccent", sw.id)}
                          className="awg-swatch-radio"
                        />
                        <span
                          className="awg-swatch-dot"
                          style={{ background: sw.bg }}
                          aria-hidden="true"
                        />
                        <span className="awg-swatch-label">{sw.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <label
                  htmlFor={`${instanceId}-ed-default-awg`}
                  className={`awg-profile-subgroup-card awg-inline-toggle-card ${
                    profileDraft.defaultAwgMode ? "is-checked" : ""
                  }`}
                  style={{ "--sg-accent": "#38bdf8" }}
                >
                  <input
                    id={`${instanceId}-ed-default-awg`}
                    type="checkbox"
                    name="defaultAwgMode"
                    checked={profileDraft.defaultAwgMode}
                    onChange={(e) => updateDraftField("defaultAwgMode", e.target.checked)}
                    className="awg-profile-checkbox"
                  />
                  <span className="awg-sg-content">
                    <span className="awg-sg-title">Enable AWG Mode automatically on login</span>
                    <span className="awg-sg-desc">
                      Automatically switches on <code>/awg</code> cross-study grounding for your
                      sessions.
                    </span>
                  </span>
                </label>

                <div className="awg-editor-actions">
                  <button
                    type="submit"
                    className="ch-primary-btn"
                    disabled={savingProfile}
                    data-testid="save-custom-profile-btn"
                  >
                    <Check size={14} />
                    <span>{savingProfile ? "Saving…" : "Save Profile Changes"}</span>
                  </button>

                  <div className="awg-portability-actions">
                    <button
                      type="button"
                      className="ch-ghost-btn"
                      onClick={handleExportProfile}
                      data-testid="export-profile-btn"
                    >
                      <Download size={12} />
                      <span>Export JSON</span>
                    </button>
                    <button
                      type="button"
                      className="ch-ghost-btn"
                      onClick={() => importFileRef.current?.click()}
                      data-testid="import-profile-btn"
                    >
                      <Upload size={12} />
                      <span>Import JSON</span>
                    </button>
                    <input
                      ref={importFileRef}
                      type="file"
                      accept=".json,application/json"
                      onChange={handleImportProfileFile}
                      className="visually-hidden"
                      aria-label="Import AWG researcher profile JSON"
                    />
                    <button
                      type="button"
                      className="ch-ghost-btn is-danger"
                      onClick={openDeleteConfirmDialog}
                      data-testid="delete-profile-btn"
                    >
                      <Trash2 size={12} />
                      <span>Delete Local Profile</span>
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Collapsible Session & Token Verification Diagnostics */}
            <details className="awg-session-details">
              <summary className="awg-session-summary">
                <span>Firebase Session &amp; Token Verification Details</span>
                <button
                  type="button"
                  className="ch-ghost-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    handleRefreshTokenAudit();
                  }}
                  disabled={submitting}
                >
                  <RefreshCw size={12} />
                  <span>Refresh Session</span>
                </button>
              </summary>
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
            </details>

            <div className="auth-nav-footer">
              <button type="button" className="ch-primary-btn" onClick={onBackToChat}>
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

            {/* Native Modal Confirmation Dialog for Destructive Profile Reset */}
            <dialog
              ref={deleteDialogRef}
              className="awg-profile-dialog"
              aria-labelledby={deleteTitleId}
              onClose={handleDeleteDialogClose}
              data-testid="delete-profile-dialog"
            >
              <h2 id={deleteTitleId} className="awg-dialog-title">
                Delete local AWG profile from this browser?
              </h2>
              <p className="awg-dialog-copy">
                This clears your checked AWG subgroups, affiliation, ORCID, and preferences stored
                in this browser. Your Firebase Auth account itself stays intact and you can set up a
                fresh profile anytime.
              </p>
              <form method="dialog" className="awg-dialog-actions">
                <button
                  type="submit"
                  value="cancel"
                  className="ch-secondary-btn"
                  autoFocus
                  data-testid="cancel-delete-profile-btn"
                >
                  Keep Profile
                </button>
                <button
                  type="submit"
                  value="delete"
                  className="awg-danger-confirm-btn"
                  data-testid="confirm-delete-profile-btn"
                >
                  Delete Local Profile
                </button>
              </form>
            </dialog>
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
                Sign in with Email/Password or Google to unlock a guided AWG subgroup profile,
                personalized study presets, and Contributor Hub auto-fill. Guest chat always stays
                open.
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
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
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
                      aria-pressed={showPassword}
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
