import { useState } from "react";
import MediaProvenanceBadge from "./MediaProvenanceBadge.jsx";

export default function AwgMediaGallery({ mediaSet, onClose }) {
  const items = mediaSet?.items || [];
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isZoomed, setIsZoomed] = useState(false);

  if (!items.length) return null;

  const activeItem = items[selectedIndex] || items[0];

  const handleDownload = (item) => {
    const it = item || activeItem;
    if (!it?.imageUrl) return;
    const a = document.createElement("a");
    a.href = it.imageUrl;
    const cleanTitle = (it.title || "image").toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const studiesStr = (it.studies || []).join("_") || "osdr";
    a.download = `OSDR_AWG_${cleanTitle}_${studiesStr}.png`;
    if (it.imageUrl && it.imageUrl.startsWith("data:image/svg+xml")) {
      a.download = `OSDR_AWG_${cleanTitle}_${studiesStr}.svg`;
    }
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const getCategoryBadgeColor = (cat) => {
    switch (cat) {
      case "data_visualization":
        return "badge-dataviz";
      case "biological_concept":
        return "badge-bioconcept";
      case "contextual_narrative":
        return "badge-context";
      default:
        return "badge-accession";
    }
  };

  return (
    <div className="awg-gallery-container">
      {/* Gallery Header */}
      <div className="awg-gallery-header">
        <div className="awg-gallery-title-area">
          <div className="awg-gallery-badge-row">
            <span className="awg-gallery-icon">✦</span>
            <strong>Grounded AWG Media Gallery</strong>
            <span className="awg-gallery-count-pill">{items.length} Artifacts</span>
          </div>
          {mediaSet?.plan?.theme && (
            <div className="awg-gallery-theme">{mediaSet.plan.theme}</div>
          )}
        </div>
        <div className="awg-gallery-header-actions">
          <button
            className="ctrl-btn-small"
            onClick={() => handleDownload(activeItem)}
            title="Download active artifact"
          >
            ⬇ Download
          </button>
          {onClose && (
            <button className="awg-close-btn" onClick={onClose} title="Close gallery">
              ×
            </button>
          )}
        </div>
      </div>

      {/* Category Tab Switcher Bar */}
      <div className="awg-gallery-tabs">
        {items.map((item, idx) => {
          const isActive = idx === selectedIndex;
          return (
            <button
              key={item.id || idx}
              className={`awg-gallery-tab ${isActive ? "active" : ""} ${getCategoryBadgeColor(item.category)}`}
              onClick={() => setSelectedIndex(idx)}
            >
              <span className="tab-category-indicator" />
              <span className="tab-title">{item.title}</span>
            </button>
          );
        })}
      </div>

      {/* Active Featured Image Display */}
      <div className="awg-gallery-featured-stage" onClick={() => setIsZoomed(true)}>
        <img
          src={activeItem.imageUrl}
          alt={activeItem.caption || activeItem.title}
          referrerPolicy="no-referrer"
          className="awg-gallery-img"
        />
        <div className="awg-gallery-zoom-overlay">
          <span>🔍 Click to expand full resolution</span>
        </div>
      </div>

      {/* Active Item Metadata Footer */}
      <div className="awg-gallery-item-footer">
        <div className="awg-gallery-meta-left">
          <div className="awg-gallery-category-tag">
            <span className={`cat-pill ${getCategoryBadgeColor(activeItem.category)}`}>
              {activeItem.categoryLabel || "Scientific Output"}
            </span>
            {activeItem.styleVariation && (
              <span className="awg-variation-pill" title={`Palette: ${activeItem.styleVariation.paletteName}`}>
                🎨 {activeItem.styleVariation.name || activeItem.styleVariation.layoutTitle}
              </span>
            )}
            {activeItem.provenance ? (
              <MediaProvenanceBadge provenance={activeItem.provenance} />
            ) : (
              <span
                className={`awg-source-tag ${
                  activeItem.generationSource === "gemini_image" || activeItem.generationSource === "gemini_imagen"
                    ? "source-gemini"
                    : "source-fallback"
                }`}
              >
                {activeItem.generationSource === "gemini_image" || activeItem.generationSource === "gemini_imagen"
                  ? "✦ Fresh provider generation (Gemini Image)"
                  : "📐 Conceptual local fallback"}
              </span>
            )}
          </div>
          <div className="awg-gallery-caption">{activeItem.description}</div>
        </div>
        <div className="awg-gallery-meta-right">
          {(activeItem.studies || []).map((sid) => (
            <span key={sid} className="awg-chip-small">
              {sid}
            </span>
          ))}
        </div>
      </div>

      {/* Thumbnails Row */}
      <div className="awg-gallery-thumbnails">
        {items.map((item, idx) => {
          const isActive = idx === selectedIndex;
          return (
            <div
              key={item.id || idx}
              className={`awg-thumb-card ${isActive ? "active" : ""}`}
              onClick={() => setSelectedIndex(idx)}
            >
              <div className="awg-thumb-img-wrapper">
                <img
                  src={item.imageUrl}
                  alt={item.title}
                  referrerPolicy="no-referrer"
                  className="awg-thumb-img"
                />
              </div>
              <div className="awg-thumb-info">
                <div className="awg-thumb-label">{item.title}</div>
                <div className="awg-thumb-cat">{item.styleVariation?.layoutTitle || item.categoryLabel}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Zoom View */}
      {isZoomed && (
        <div className="awg-modal-overlay" onClick={() => setIsZoomed(false)}>
          <div className="awg-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="awg-modal-header">
              <div className="modal-title-row">
                <span className={`cat-pill ${getCategoryBadgeColor(activeItem.category)}`}>
                  {activeItem.categoryLabel}
                </span>
                <strong>{activeItem.title}</strong>
              </div>
              <div className="modal-actions">
                <button
                  className="ctrl-btn-small"
                  onClick={() => handleDownload(activeItem)}
                >
                  ⬇ Download
                </button>
                <button className="awg-close-btn" onClick={() => setIsZoomed(false)}>
                  ×
                </button>
              </div>
            </div>
            <div className="awg-modal-body">
              <img
                src={activeItem.imageUrl}
                alt={activeItem.title}
                referrerPolicy="no-referrer"
                className="awg-modal-img"
              />
            </div>
            <div className="awg-modal-footer">
              <span>{activeItem.description}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
