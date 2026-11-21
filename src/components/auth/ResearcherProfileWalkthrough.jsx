import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Compass,
  Sparkles,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import {
  AVATAR_ACCENTS,
  AWG_PROFILE_SUBGROUPS,
  RESEARCH_FOCUS_OPTIONS,
  computeProfileInitials,
  getAvatarAccentSpec,
  normalizeOrcid,
  validateOrcidFormat,
} from "../../utils/researcherProfile.js";

const STEPS = [
  { id: 1, label: "Researcher Identity", shortLabel: "1. Identity" },
  { id: 2, label: "AWG Subgroups", shortLabel: "2. AWG Subgroups" },
  { id: 3, label: "Workspace Preferences", shortLabel: "3. Preferences" },
];

const MODEL_PREFERENCE_OPTIONS = [
  { value: "", label: "Default (Auto-selected Free Frontier Model)" },
  { value: "gemini-4-argon", label: "Gemini 4 Argon (Reasoning · 1M)" },
  { value: "gemini-3.7-flash", label: "Gemini 3.7 Flash (Balanced · Free Tier)" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Fast · Free Tier)" },
  { value: "openrouter/free", label: "OpenRouter Free Auto-Router ($0 Live)" },
  { value: "google/gemma-4-31b-it:free", label: "Gemma 4 31B Instruct (OpenRouter · Free)" },
  { value: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "NVIDIA Nemotron 3 Ultra 550B (OpenRouter · Free)" },
  { value: "groq/llama-3.3-70b-versatile", label: "Groq Llama 3.3 70B (LPU · Free)" },
];

export default function ResearcherProfileWalkthrough({
  profile,
  firebaseUser,
  isFirstTime = false,
  onComplete,
  onSkip,
}) {
  const instanceId = useId();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState(() => ({
    displayName: profile?.displayName || firebaseUser?.displayName || "",
    affiliation: profile?.affiliation || "",
    roleTitle: profile?.roleTitle || "",
    orcid: profile?.orcid || "",
    forumHandle: profile?.forumHandle || "",
    bio: profile?.bio || "",
    avatarAccent: profile?.avatarAccent || "cyan",
    avatarBadge: profile?.avatarBadge || "",
    awgSubgroups: Array.isArray(profile?.awgSubgroups) ? profile.awgSubgroups : [],
    researchFocus: profile?.researchFocus || "multi-omics",
    preferredModel: profile?.preferredModel || "",
    defaultAwgMode: Boolean(profile?.defaultAwgMode),
  }));
  const [orcidError, setOrcidError] = useState("");
  const [saving, setSaving] = useState(false);

  const stepHeadingRef = useRef(null);
  const orcidInputRef = useRef(null);
  const hasMountedRef = useRef(false);

  // Move focus to the new step heading when transitioning steps (multi-page forms best practice)
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    stepHeadingRef.current?.focus();
  }, [step]);

  const updateField = (key, value) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    if (key === "orcid" && orcidError) {
      setOrcidError("");
    }
  };

  const toggleSubgroup = (subgroupId) => {
    setDraft((prev) => {
      const current = new Set(prev.awgSubgroups);
      if (current.has(subgroupId)) {
        current.delete(subgroupId);
      } else {
        current.add(subgroupId);
      }
      return { ...prev, awgSubgroups: Array.from(current) };
    });
  };

  const handleOrcidBlur = () => {
    if (!draft.orcid.trim()) {
      setOrcidError("");
      return;
    }
    const check = validateOrcidFormat(draft.orcid);
    if (!check.valid) {
      setOrcidError(check.error);
    } else {
      setOrcidError("");
      if (check.normalized !== draft.orcid) {
        updateField("orcid", check.normalized);
      }
    }
  };

  const handleNextStep = (e) => {
    e?.preventDefault?.();
    if (step === 1) {
      const check = validateOrcidFormat(draft.orcid);
      if (!check.valid) {
        setOrcidError(check.error);
        orcidInputRef.current?.focus();
        return;
      }
      if (check.normalized !== draft.orcid) {
        updateField("orcid", check.normalized);
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      setStep(3);
      return;
    }
    handleFinish();
  };

  const handleFinish = async () => {
    const check = validateOrcidFormat(draft.orcid);
    if (!check.valid) {
      setStep(1);
      setOrcidError(check.error);
      return;
    }
    setSaving(true);
    try {
      await onComplete?.({
        ...draft,
        orcid: normalizeOrcid(draft.orcid),
        onboardingCompleted: true,
        onboardingDismissed: false,
      });
    } finally {
      setSaving(false);
    }
  };

  const accentSpec = getAvatarAccentSpec(draft.avatarAccent);
  const previewInitials = computeProfileInitials(draft, firebaseUser);
  const selectedCount = draft.awgSubgroups.length;
  const headingId = `${instanceId}-step-heading`;
  const orcidErrId = `${instanceId}-orcid-error`;
  const orcidHelpId = `${instanceId}-orcid-help`;

  return (
    <section
      className="auth-card awg-walkthrough-card"
      aria-labelledby={headingId}
      data-testid="researcher-walkthrough"
    >
      <div className="awg-wt-top">
        <div>
          <div className="auth-kicker">
            <Sparkles size={13} />
            <span>
              {isFirstTime
                ? "Welcome · Optional Researcher Profile Setup"
                : "Guided AWG Profile Walkthrough"}
            </span>
          </div>
          <h1 className="auth-title" id={headingId} ref={stepHeadingRef} tabIndex={-1}>
            {step === 1
              ? "Step 1 of 3 · Customize Your Researcher Profile"
              : step === 2
              ? "Step 2 of 3 · Check Off Your NASA OSDR AWG Subgroups"
              : "Step 3 of 3 · Set Your Workspace Preferences"}
          </h1>
          <p className="auth-subtitle">
            {step === 1
              ? "Personalize how your profile appears in the sidebar and auto-fill Contributor Hub forms. Saved strictly in your browser per Firebase UID ($0 server footprint)."
              : step === 2
              ? "Select every Analysis Working Group you follow or contribute to. Matching OSDR study presets and sidebar badges will adapt automatically."
              : "Choose your primary research focus and preferred free-tier model family. You can update, export, or delete your profile anytime."}
          </p>
        </div>

        <button
          type="button"
          className="ch-ghost-btn awg-wt-skip-btn"
          onClick={() => onSkip?.()}
          data-testid="walkthrough-skip-btn"
        >
          <X size={13} />
          <span>{isFirstTime ? "Skip for now" : "Cancel"}</span>
        </button>
      </div>

      {/* Accessible Multi-Step Progress Tracker */}
      <nav aria-label="Profile setup progress" className="awg-wt-progress-nav">
        <ol className="awg-wt-progress-list">
          {STEPS.map((item) => {
            const isActive = item.id === step;
            const isDone = item.id < step;
            return (
              <li
                key={item.id}
                className={`awg-wt-step-pill ${isActive ? "is-active" : ""} ${
                  isDone ? "is-done" : ""
                }`}
                aria-current={isActive ? "step" : undefined}
              >
                <button
                  type="button"
                  className="awg-wt-step-btn"
                  onClick={() => {
                    if (step === 1 && item.id > 1) {
                      const check = validateOrcidFormat(draft.orcid);
                      if (!check.valid) {
                        setOrcidError(check.error);
                        orcidInputRef.current?.focus();
                        return;
                      }
                    }
                    setStep(item.id);
                  }}
                >
                  <span className="awg-wt-step-num" aria-hidden="true">
                    {isDone ? <Check size={11} /> : item.id}
                  </span>
                  <span>{item.shortLabel}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <form className="awg-wt-form" onSubmit={handleNextStep} noValidate>
        {/* STEP 1: IDENTITY & AVATAR */}
        {step === 1 && (
          <div className="awg-wt-step-body" data-testid="walkthrough-step-1">
            <div className="awg-wt-preview-strip">
              <div
                className="awg-profile-avatar-circle"
                style={{
                  background: accentSpec.bg,
                  boxShadow: `0 0 0 2px ${accentSpec.ring}55`,
                }}
                aria-hidden="true"
              >
                {previewInitials}
              </div>
              <div className="awg-wt-preview-copy">
                <div className="awg-wt-preview-name">
                  {draft.displayName.trim() || firebaseUser?.email || "OSDR Researcher"}
                </div>
                <div className="awg-wt-preview-meta">
                  {[draft.roleTitle.trim(), draft.affiliation.trim()].filter(Boolean).join(" · ") ||
                    "NASA OSDR Open-Science Researcher"}
                </div>
              </div>
            </div>

            <div className="awg-profile-form-grid">
              <div className="ch-field">
                <label htmlFor={`${instanceId}-name`} className="ch-label">
                  Display Name
                </label>
                <input
                  id={`${instanceId}-name`}
                  name="displayName"
                  type="text"
                  className="ch-input awg-profile-input"
                  value={draft.displayName}
                  onChange={(e) => updateField("displayName", e.target.value)}
                  placeholder="Dr. Ada Lovelace"
                  autoComplete="name"
                  enterKeyHint="next"
                  maxLength={80}
                  data-testid="wt-input-display-name"
                />
              </div>

              <div className="ch-field">
                <label htmlFor={`${instanceId}-affiliation`} className="ch-label">
                  Institution / Lab Affiliation
                </label>
                <input
                  id={`${instanceId}-affiliation`}
                  name="affiliation"
                  type="text"
                  className="ch-input awg-profile-input"
                  value={draft.affiliation}
                  onChange={(e) => updateField("affiliation", e.target.value)}
                  placeholder="NASA Ames / University Bioanalytics Lab"
                  autoComplete="organization"
                  enterKeyHint="next"
                  maxLength={120}
                  data-testid="wt-input-affiliation"
                />
              </div>

              <div className="ch-field">
                <label htmlFor={`${instanceId}-role`} className="ch-label">
                  Role / Title
                </label>
                <input
                  id={`${instanceId}-role`}
                  name="roleTitle"
                  type="text"
                  className="ch-input awg-profile-input"
                  value={draft.roleTitle}
                  onChange={(e) => updateField("roleTitle", e.target.value)}
                  placeholder="AWG Member, Postdoc, Bioinformatician, PI"
                  autoComplete="organization-title"
                  enterKeyHint="next"
                  maxLength={80}
                  data-testid="wt-input-role"
                />
              </div>

              <div className="ch-field">
                <label htmlFor={`${instanceId}-handle`} className="ch-label">
                  AWG Forum / GitHub Handle
                </label>
                <input
                  id={`${instanceId}-handle`}
                  name="forumHandle"
                  type="text"
                  className="ch-input awg-profile-input"
                  value={draft.forumHandle}
                  onChange={(e) => updateField("forumHandle", e.target.value)}
                  placeholder="@researcher_handle"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="next"
                  maxLength={48}
                  data-testid="wt-input-handle"
                />
              </div>

              <div className="ch-field">
                <label htmlFor={`${instanceId}-orcid`} className="ch-label">
                  ORCID iD <span className="awg-optional-tag">(Optional)</span>
                </label>
                <input
                  ref={orcidInputRef}
                  id={`${instanceId}-orcid`}
                  name="orcid"
                  type="text"
                  className="ch-input awg-profile-input"
                  value={draft.orcid}
                  onChange={(e) => updateField("orcid", e.target.value)}
                  onBlur={handleOrcidBlur}
                  placeholder="0000-0002-1825-0097"
                  aria-invalid={orcidError ? "true" : undefined}
                  aria-describedby={orcidError ? `${orcidHelpId} ${orcidErrId}` : orcidHelpId}
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="next"
                  maxLength={40}
                  data-testid="wt-input-orcid"
                />
                <span id={orcidHelpId} className="awg-field-hint">
                  16-digit format (0000-0000-0000-0000) or paste full orcid.org URL.
                </span>
                {orcidError && (
                  <span id={orcidErrId} className="awg-field-error" role="alert">
                    {orcidError}
                  </span>
                )}
              </div>

              <div className="ch-field">
                <label htmlFor={`${instanceId}-badge`} className="ch-label">
                  Custom Avatar Initials <span className="awg-optional-tag">(Up to 3 chars)</span>
                </label>
                <input
                  id={`${instanceId}-badge`}
                  name="avatarBadge"
                  type="text"
                  className="ch-input awg-profile-input"
                  value={draft.avatarBadge}
                  onChange={(e) => updateField("avatarBadge", e.target.value.toUpperCase().slice(0, 3))}
                  placeholder={previewInitials}
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  enterKeyHint="next"
                  maxLength={3}
                  data-testid="wt-input-badge"
                />
              </div>
            </div>

            <fieldset className="awg-fieldset">
              <legend className="awg-legend">Avatar Accent Theme</legend>
              <div className="awg-swatch-row">
                {AVATAR_ACCENTS.map((sw) => (
                  <label
                    key={sw.id}
                    className={`awg-swatch-option ${
                      draft.avatarAccent === sw.id ? "is-selected" : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name="avatarAccent"
                      value={sw.id}
                      checked={draft.avatarAccent === sw.id}
                      onChange={() => updateField("avatarAccent", sw.id)}
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
          </div>
        )}

        {/* STEP 2: AWG SUBGROUP CHECKLIST */}
        {step === 2 && (
          <div className="awg-wt-step-body" data-testid="walkthrough-step-2">
            <div className="awg-subgroup-toolbar">
              <div className="awg-subgroup-counter" role="status" aria-live="polite">
                <Users size={14} />
                <span>
                  <strong>{selectedCount}</strong>{" "}
                  {selectedCount === 1 ? "AWG subgroup" : "AWG subgroups"} checked
                </span>
              </div>
              <div className="awg-subgroup-quick-actions">
                <button
                  type="button"
                  className="ch-ghost-btn"
                  onClick={() =>
                    updateField(
                      "awgSubgroups",
                      AWG_PROFILE_SUBGROUPS.map((g) => g.id)
                    )
                  }
                >
                  Select All
                </button>
                <button
                  type="button"
                  className="ch-ghost-btn"
                  onClick={() => updateField("awgSubgroups", [])}
                  disabled={selectedCount === 0}
                >
                  Clear
                </button>
              </div>
            </div>

            <fieldset className="awg-fieldset">
              <legend className="awg-legend">
                NASA OSDR Analysis Working Groups (Check all that apply)
              </legend>
              <div className="awg-profile-subgroup-grid">
                {AWG_PROFILE_SUBGROUPS.map((group) => {
                  const checked = draft.awgSubgroups.includes(group.id);
                  const inputId = `${instanceId}-sg-${group.shortLabel.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
                  return (
                    <label
                      key={group.id}
                      htmlFor={inputId}
                      className={`awg-profile-subgroup-card ${checked ? "is-checked" : ""}`}
                      style={{ "--sg-accent": group.accent }}
                      data-testid={`subgroup-option-${group.shortLabel.toLowerCase().replace(/[^a-z0-9]/g, "")}`}
                    >
                      <input
                        id={inputId}
                        type="checkbox"
                        name="awgSubgroups"
                        value={group.id}
                        checked={checked}
                        onChange={() => toggleSubgroup(group.id)}
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
          </div>
        )}

        {/* STEP 3: RESEARCH PREFERENCES & MODEL DEFAULTS */}
        {step === 3 && (
          <div className="awg-wt-step-body" data-testid="walkthrough-step-3">
            <fieldset className="awg-fieldset">
              <legend className="awg-legend">Primary Research Focus</legend>
              <div className="awg-focus-grid">
                {RESEARCH_FOCUS_OPTIONS.map((opt) => {
                  const selected = draft.researchFocus === opt.id;
                  const radioId = `${instanceId}-focus-${opt.id}`;
                  return (
                    <label
                      key={opt.id}
                      htmlFor={radioId}
                      className={`awg-focus-card ${selected ? "is-selected" : ""}`}
                    >
                      <input
                        id={radioId}
                        type="radio"
                        name="researchFocus"
                        value={opt.id}
                        checked={selected}
                        onChange={() => updateField("researchFocus", opt.id)}
                        className="awg-focus-radio"
                      />
                      <span className="awg-sg-content">
                        <span className="awg-sg-title">{opt.label}</span>
                        <span className="awg-sg-desc">{opt.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="awg-profile-form-grid">
              <div className="ch-field">
                <label htmlFor={`${instanceId}-model`} className="ch-label">
                  Preferred Free Model Family
                </label>
                <select
                  id={`${instanceId}-model`}
                  name="preferredModel"
                  className="ch-input awg-profile-input"
                  value={draft.preferredModel}
                  onChange={(e) => updateField("preferredModel", e.target.value)}
                  data-testid="wt-select-model"
                >
                  {MODEL_PREFERENCE_OPTIONS.map((opt) => (
                    <option key={opt.value || "default"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ch-field">
                <label htmlFor={`${instanceId}-bio`} className="ch-label">
                  Short Research Note <span className="awg-optional-tag">(Optional)</span>
                </label>
                <input
                  id={`${instanceId}-bio`}
                  name="bio"
                  type="text"
                  className="ch-input awg-profile-input"
                  value={draft.bio}
                  onChange={(e) => updateField("bio", e.target.value)}
                  placeholder="e.g., Focusing on RR-9 retinal epigenetics & SANS countermeasures"
                  enterKeyHint="done"
                  maxLength={260}
                />
              </div>
            </div>

            <label
              htmlFor={`${instanceId}-default-awg`}
              className={`awg-profile-subgroup-card awg-inline-toggle-card ${
                draft.defaultAwgMode ? "is-checked" : ""
              }`}
              style={{ "--sg-accent": "#38bdf8" }}
            >
              <input
                id={`${instanceId}-default-awg`}
                type="checkbox"
                name="defaultAwgMode"
                checked={draft.defaultAwgMode}
                onChange={(e) => updateField("defaultAwgMode", e.target.checked)}
                className="awg-profile-checkbox"
              />
              <span className="awg-sg-content">
                <span className="awg-sg-title">Start chat sessions with AWG Mode enabled</span>
                <span className="awg-sg-desc">
                  Automatically prefixes research queries with <code>/awg</code> cross-study grounding
                  when you open a workspace session.
                </span>
              </span>
            </label>

            <div className="awg-wt-privacy-note">
              <UserCheck size={14} />
              <span>
                <strong>Local-First Profile (Option A):</strong> Stored strictly in your browser
                under your Firebase UID. Export JSON anytime to carry across lab workstations, or
                delete with one click.
              </span>
            </div>
          </div>
        )}

        {/* FOOTER NAVIGATION */}
        <div className="awg-wt-footer">
          <div className="awg-wt-footer-left">
            {step > 1 ? (
              <button
                type="button"
                className="ch-secondary-btn"
                onClick={() => setStep((s) => Math.max(1, s - 1))}
                enterKeyHint="previous"
                data-testid="walkthrough-back-btn"
              >
                <ArrowLeft size={14} />
                <span>Previous</span>
              </button>
            ) : (
              <span className="awg-wt-step-hint">
                <Compass size={13} />
                <span>Takes ~30 seconds · 100% optional</span>
              </span>
            )}
          </div>

          <div className="awg-wt-footer-right">
            {step < 3 ? (
              <button
                type="submit"
                className="ch-primary-btn"
                enterKeyHint="next"
                data-testid="walkthrough-next-btn"
              >
                <span>Next: {STEPS[step].label}</span>
                <ArrowRight size={14} />
              </button>
            ) : (
              <button
                type="submit"
                className="ch-primary-btn"
                disabled={saving}
                enterKeyHint="done"
                data-testid="walkthrough-save-btn"
              >
                <CheckCircle2 size={14} />
                <span>{saving ? "Saving Profile…" : "Save AWG Profile"}</span>
              </button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
