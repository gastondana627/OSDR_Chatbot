import { useState, useEffect, useRef } from "react";
import { generateAwgMediaSet, generateAwgVideo, generateTranslationalClip } from "../api.js";
import AwgMediaGallery from "./AwgMediaGallery.jsx";
import StudyBriefVideoPlayer from "./StudyBriefVideoPlayer.jsx";
import RelatableClipPlayer from "./RelatableClipPlayer.jsx";
import AwgGuidedChooser from "./AwgGuidedChooser.jsx";
import AwgMemeCard from "./AwgMemeCard.jsx";
import MediaAuditCard from "./MediaAuditCard.jsx";
import AccessionValidationCard from "./AccessionValidationCard.jsx";
import EvidenceAuditCard from "./EvidenceAuditCard.jsx";

const STUDY_URL = "https://osdr.nasa.gov/bio/repo/data/studies/";

export default function Message({ message, streaming, onUpdateMessage, onRunCommand, recentPair }) {
  const isUser = message.role === "user";
  const isAwg =
    message.isAwg ||
    (isUser && message.content.trim().toLowerCase().startsWith("/awg"));
  const isGuidedChooser = message.isAwgChooser || message.awgDetails?.isGuidedChooser;
  const isMemeMode = Boolean(message.isAwgMeme || message.awgDetails?.isMemeMode);
  const isAuditMode = Boolean(message.isAwgAudit || message.awgDetails?.isAwgAudit || message.awgDetails?.action === "media_audit");
  const validationError = message.awgDetails?.validationError || (message.isAwgValidation && message.awgDetails);

  const [loadingMediaSet, setLoadingMediaSet] = useState(false);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [loadingClip, setLoadingClip] = useState(false);
  const [mediaError, setMediaError] = useState("");

  const mediaSet = message.mediaSet || (message.imageData?.mediaSet ? { items: message.imageData.mediaSet, plan: null } : null);
  const videoData = message.videoData;
  const clipData = message.clipData;
  const hasGroundedStudies = Array.isArray(message.sources) && message.sources.length > 0;

  const autoFetchTriggeredRef = useRef(false);

  // Auto-generate the grounded image set after AWG stream finishes (only when comparing actual studies, not in chooser, meme, or audit mode)
  useEffect(() => {
    if (
      !isUser &&
      isAwg &&
      !isGuidedChooser &&
      !isMemeMode &&
      !isAuditMode &&
      !streaming &&
      hasGroundedStudies &&
      !mediaSet &&
      !loadingMediaSet &&
      !autoFetchTriggeredRef.current
    ) {
      autoFetchTriggeredRef.current = true;
      handleFetchMediaSet();
    }
  }, [isUser, isAwg, isGuidedChooser, isMemeMode, isAuditMode, streaming, hasGroundedStudies, mediaSet]);

  const handleFetchMediaSet = async () => {
    if (!hasGroundedStudies || loadingMediaSet) return;
    setLoadingMediaSet(true);
    setMediaError("");
    try {
      const res = await generateAwgMediaSet({
        studies: message.sources,
        query: message.content,
        summary: message.content,
      });
      if (onUpdateMessage) {
        onUpdateMessage({ ...message, mediaSet: res });
      }
    } catch (err) {
      setMediaError(err?.message || "Failed to generate grounded media set");
    } finally {
      setLoadingMediaSet(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (!hasGroundedStudies || loadingVideo) return;
    setLoadingVideo(true);
    setMediaError("");
    try {
      const res = await generateAwgVideo({
        studies: message.sources,
        query: message.content,
        summary: message.content,
      });
      if (onUpdateMessage) {
        onUpdateMessage({ ...message, videoData: res });
      }
    } catch (err) {
      setMediaError(err?.message || "Failed to generate study brief video");
    } finally {
      setLoadingVideo(false);
    }
  };

  const handleGenerateClip = async () => {
    if (!hasGroundedStudies || loadingClip) return;
    setLoadingClip(true);
    setMediaError("");
    try {
      const res = await generateTranslationalClip({
        studies: message.sources,
        query: message.content,
        summary: message.content,
      });
      if (onUpdateMessage) {
        onUpdateMessage({ ...message, clipData: res });
      }
    } catch (err) {
      setMediaError(err?.message || "Failed to generate relatable translational clip");
    } finally {
      setLoadingClip(false);
    }
  };

  return (
    <div
      className={
        "msg " +
        (isUser ? "user" : "assistant") +
        (isAwg ? " is-awg-response" : "") +
        (isUser && isAwg ? " is-awg-prompt" : "")
      }
    >
      <div className="role">
        {isUser ? (
          "You"
        ) : (
          <>
            <span>NASA OSDR Assistant</span>
            {isAwg && (
              <span className="awg-badge">
                ✦ AWG Analysis Mode
              </span>
            )}
          </>
        )}
      </div>

      <div className="content">
        {typeof message.content === "string"
          ? message.content
          : typeof message.content === "object" && message.content !== null
          ? JSON.stringify(message.content, null, 2)
          : String(message.content || "")}
        {streaming && <span className="cursor">▋</span>}
      </div>

      {/* Sources & study accession chips */}
      {!isUser && Array.isArray(message.sources) && message.sources.length > 0 && (
        <div className="sources">
          <span className="sources-label">Cited OSDR Studies:</span>
          {message.sources.map((sid, sIdx) => {
            const sidStr = typeof sid === "string" ? sid : sid?.study_id || `OSD-${sIdx + 1}`;
            return (
              <a
                key={sidStr + sIdx}
                className="chip"
                href={STUDY_URL + sidStr}
                target="_blank"
                rel="noreferrer"
                title={`View ${sidStr} on NASA OSDR`}
              >
                {sidStr} ↗
              </a>
            );
          })}
        </div>
      )}

      {/* AWG Guided Chooser Panel */}
      {!isUser && isGuidedChooser && !streaming && (
        <AwgGuidedChooser
          initialSuggestions={message.awgDetails?.suggestedPairs}
          recentPair={recentPair}
          onRunComparison={(studyA, studyB) => onRunCommand?.(`/awg compare ${studyA} ${studyB}`)}
          onRunRandom={() => onRunCommand?.("/awg random")}
          onSelectCommand={(cmd) => onRunCommand?.(cmd)}
        />
      )}

      {/* AWG Strict Accession Validation Error State */}
      {!isUser && validationError && !streaming && (
        <AccessionValidationCard
          validation={validationError}
          onRunCommand={onRunCommand}
          onConfirmReplacement={(studyA, studyB) => onRunCommand?.(`/awg compare ${studyA} ${studyB}`)}
        />
      )}

      {/* Experimental AWG Meme Outreach Mode Component */}
      {!isUser && isMemeMode && message.awgDetails?.memeConcept && !streaming && !validationError && (
        <AwgMemeCard
          memeConcept={message.awgDetails.memeConcept}
          studies={message.sources}
          onRunCommand={onRunCommand}
        />
      )}

      {/* Auditable Media Provenance Registry Component (/awg media audit) */}
      {!isUser && isAuditMode && !streaming && (
        <MediaAuditCard
          initialAuditLog={message.awgDetails?.auditLog}
          onRunCommand={onRunCommand}
        />
      )}

      {/* NASA OSDR Evidence & Provenance Audit Card */}
      {!isUser && isAwg && message.awgDetails?.evidenceMap && !streaming && !isGuidedChooser && !isMemeMode && !isAuditMode && (
        <EvidenceAuditCard
          evidenceMap={message.awgDetails.evidenceMap}
        />
      )}

      {/* Standard AWG Media Mode Section (Image Gallery, Motion Brief, Relatable Clip) */}
      {!isUser && isAwg && !isGuidedChooser && !isMemeMode && !isAuditMode && !validationError && !streaming && message.content && (
        <div className="awg-media-section">
          {/* Loading Skeleton for Image Set if generating */}
          {loadingMediaSet && (
            <div className="awg-loading-card">
              <div className="spinner" />
              <div className="awg-loading-text">
                <strong>Synthesizing Grounded AWG Media Set…</strong>
                <span>Generating Data Viz, Biological Mechanism, Contextual Scene &amp; Accession Summary</span>
              </div>
            </div>
          )}

          {/* Rendered AWG Multi-Output Media Gallery */}
          {mediaSet && !loadingMediaSet && (
            <AwgMediaGallery
              mediaSet={mediaSet}
              onClose={() => onUpdateMessage?.({ ...message, mediaSet: null })}
            />
          )}

          {/* AWG 3-Mode Media Toolbar */}
          <div className="awg-media-toolbar">
            {/* Mode 3: Relatable Translational Clip */}
            <button
              className="awg-media-btn btn-translational-clip"
              onClick={handleGenerateClip}
              disabled={!hasGroundedStudies || loadingClip}
              title={
                hasGroundedStudies
                  ? "Generate a concise, creative translational video clip communicating real-world mission & astronaut health relevance grounded in the active study pair"
                  : "Requires grounded OSDR study accessions"
              }
            >
              {loadingClip ? (
                <>
                  <span className="spinner" /> Synthesizing Translational Clip…
                </>
              ) : (
                <>
                  <span>🎥</span> Generate Relatable Clip
                </>
              )}
            </button>

            {/* Mode 2: Scientific Motion Brief */}
            <button
              className="awg-media-btn btn-video"
              onClick={handleGenerateVideo}
              disabled={!hasGroundedStudies || loadingVideo}
              title={
                hasGroundedStudies
                  ? "Generate a grounded scientific motion brief synthesizing analog fluid dynamics, cross-omics synchrony, and countermeasure target lock"
                  : "Requires grounded OSDR study accessions"
              }
            >
              {loadingVideo ? (
                <>
                  <span className="spinner" /> Synthesizing Motion Brief…
                </>
              ) : (
                <>
                  <span>🎬</span> Generate Scientific Motion Brief
                </>
              )}
            </button>

            {/* Mode 1: Image Gallery (Regenerate if closed) */}
            {!mediaSet && !loadingMediaSet && hasGroundedStudies && (
              <button
                className="awg-media-btn"
                onClick={handleFetchMediaSet}
                title="Generate grounded 4-image visual package"
              >
                <span>🖼️</span> Regenerate Image Gallery
              </button>
            )}
          </div>

          <div className="awg-media-note">
            {hasGroundedStudies ? (
              <span>ℹ️ Three Grounded AWG Media Experiences: <strong>🖼️ Image Gallery</strong> (Stills) · <strong>🎬 Motion Brief</strong> (Analytical) · <strong>🎥 Relatable Clip</strong> (Translational / Real-World Context).</span>
            ) : (
              <span style={{ color: "#f87171" }}>
                ⚠️ Media generation requires at least one grounded OSDR study accession.
              </span>
            )}
          </div>

          {mediaError && <div className="awg-media-error">{mediaError}</div>}

          {/* Rendered Relatable Translational Clip Player */}
          {clipData && (
            <RelatableClipPlayer
              clipData={clipData}
              onClose={() => onUpdateMessage?.({ ...message, clipData: null })}
              onUpdateClip={(newClip) => onUpdateMessage?.({ ...message, clipData: newClip })}
            />
          )}

          {/* Rendered 5-second Scientific Motion Brief Player */}
          {videoData && (
            <StudyBriefVideoPlayer
              videoData={videoData}
              onClose={() => onUpdateMessage?.({ ...message, videoData: null })}
            />
          )}
        </div>
      )}
    </div>
  );
}
