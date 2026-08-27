import { useState } from "react";

export default function VisualAbstractCard({ imageData, onClose }) {
  const [isZoomed, setIsZoomed] = useState(false);

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = imageData.imageUrl;
    a.download = `OSDR_AWG_Visual_Abstract_${(imageData.studies || []).join("_") || "comparison"}.png`;
    if (imageData.imageUrl.startsWith("data:image/svg+xml")) {
      a.download = `OSDR_AWG_Visual_Abstract_${(imageData.studies || []).join("_") || "comparison"}.svg`;
    }
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="awg-image-container">
      <div className="awg-image-header">
        <div className="awg-image-title">
          <span className="awg-image-icon">🖼️</span>
          <strong>Scientific Visual Abstract</strong>
          <span className="awg-image-badge">
            {imageData.generationSource === "gemini_image" || imageData.generationSource === "gemini_imagen"
              ? "✦ Gemini Image (gemini-3.1-flash-lite-image)"
              : imageData.fallbackUsed && imageData.fallbackReason && imageData.fallbackReason !== "none"
              ? `📐 NASA OSDR Vector Fallback (${imageData.fallbackReason.replace(/_/g, " ")})`
              : "📐 NASA OSDR Vector Fallback"}
          </span>
        </div>
        <div className="awg-image-actions">
          <button className="ctrl-btn-small" onClick={handleDownload} title="Download high-res abstract">
            ⬇ Download
          </button>
          {onClose && (
            <button className="awg-close-btn" onClick={onClose} title="Close abstract">
              ×
            </button>
          )}
        </div>
      </div>

      <div className="awg-image-preview" onClick={() => setIsZoomed(true)}>
        <img
          src={imageData.imageUrl}
          alt={imageData.caption || "OSDR AWG Visual Abstract"}
          referrerPolicy="no-referrer"
          className="awg-img"
        />
        <div className="awg-image-zoom-hint">🔍 Click to expand</div>
      </div>

      <div className="awg-image-footer">
        <div className="awg-image-caption">{imageData.caption}</div>
        <div className="awg-image-studies">
          {(imageData.studies || []).map((s) => (
            <span key={s} className="awg-chip-small">
              {s}
            </span>
          ))}
        </div>
      </div>

      {isZoomed && (
        <div className="awg-modal-overlay" onClick={() => setIsZoomed(false)}>
          <div className="awg-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="awg-modal-header">
              <span>{imageData.caption}</span>
              <button className="awg-close-btn" onClick={() => setIsZoomed(false)}>
                ×
              </button>
            </div>
            <div className="awg-modal-body">
              <img
                src={imageData.imageUrl}
                alt={imageData.caption}
                referrerPolicy="no-referrer"
                className="awg-modal-img"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
