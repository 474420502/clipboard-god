import React, { useRef, useEffect } from 'react';
import { truncateText } from '../utils/text';

function HistoryItem({ item, index, previewLength = 120, showShortcuts = true, isSelected = false, setSelectedIndex, setKeyboardNavigationMode }) {
  const itemRef = useRef(null);

  // rAF-based stability detection: wait until bounding rect is stable for N consecutive frames
  const rafId = useRef(null);
  const lastRect = useRef(null);
  const stableCount = useRef(0);
  const STABLE_FRAMES = 3; // require 3 consecutive frames with identical rect

  useEffect(() => {
    // cancel previous rAF if any
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    lastRect.current = null;
    stableCount.current = 0;

    if (isSelected && itemRef.current) {
      // Scroll into view. If keyboard navigation is active (we suppress mouse hover),
      // jump immediately to make navigation snappier; otherwise use smooth scroll.
      try {
        const suppress = typeof window !== 'undefined' && !!window.__suppressMouseHover;
        if (suppress) {
          itemRef.current.scrollIntoView({ behavior: 'auto', block: 'nearest' });
        } else {
          itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      } catch (err) {
        try { itemRef.current.scrollIntoView({ block: 'nearest' }); } catch (e) { }
      }

      const checkStable = () => {
        try {
          const rect = itemRef.current.getBoundingClientRect();
          const rectKey = `${Math.round(rect.top)}:${Math.round(rect.left)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;

          if (lastRect.current === rectKey) {
            stableCount.current += 1;
          } else {
            stableCount.current = 1;
            lastRect.current = rectKey;
          }

          if (stableCount.current >= STABLE_FRAMES) {
            // stable, show tooltip
            try {
              if (window.electronAPI && typeof window.electronAPI.showTooltip === 'function') {
                // Round the bounding rect values to integers so tiny sub-pixel
                // or fractional changes during scrolling don't cause the tooltip
                // to reposition constantly. This keeps the tooltip visually
                // stable while the list scrolls slightly.
                const anchorRect = {
                  top: Math.round(rect.top),
                  left: Math.round(rect.left),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height)
                };

                window.electronAPI.showTooltip({
                  content: isText ? item.content : 'Click to paste image',
                  anchorRect
                });
              }
            } catch (err) { }
            rafId.current = null;
            return;
          }
        } catch (err) {
          // ignore
        }

        rafId.current = requestAnimationFrame(checkStable);
      };

      rafId.current = requestAnimationFrame(checkStable);
    } else {
      // Hide tooltip immediately when unselected
      try {
        if (window.electronAPI && typeof window.electronAPI.hideTooltip === 'function') {
          window.electronAPI.hideTooltip();
        }
      } catch (err) { }
    }

    return () => {
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      lastRect.current = null;
      stableCount.current = 0;
    };
  }, [isSelected, item.content]);

  const handlePaste = () => {
    try {
      if (window.electronAPI && typeof window.electronAPI.pasteItem === 'function') {
        window.electronAPI.pasteItem(item);
      } else {
        console.error('electronAPI.pasteItem is not available');
      }
    } catch (error) {
      console.error('Failed to paste item:', error);
    }
  };

  const isText = item.type === 'text';
  const isImage = item.type === 'image';
  const shortcut = (showShortcuts && index < 9) ? <span className="shortcut-hint">{index + 1}</span> : null;
  const imagePath = item.image_thumb || item.image_path;
  const displayText = isText ? truncateText(item.content, previewLength) : '';

  return (
    <li
      ref={itemRef}
      className={`history-item ${isSelected ? 'selected' : ''}`}
      onClick={handlePaste}
      onMouseEnter={setSelectedIndex ? (e) => {
        if (e && e.isTrusted && typeof setSelectedIndex === 'function') { // only allow user mouse, skip synthetic
          // check for global suppression flag via dataset on body
          try {
            const sup = window.__suppressMouseHover;
            if (sup) return;
          } catch (err) { }
          setSelectedIndex(index);
        }
      } : undefined}
    >
      <div className="item-icon">
        {isText && <span className="text-icon">T</span>}
        {isImage && imagePath && <img src={`file://${imagePath}`} alt="thumbnail" className="history-thumb" onError={(e) => {
          console.error('Failed to load image:', e);
          e.target.style.display = 'none';
        }} />}
        {isImage && !imagePath && <span className="image-icon">I</span>}
        {shortcut}
      </div>
      <div className="item-content">
        {isText && <span className="text-preview">{displayText}</span>}
        {isImage && '[Image]'}
      </div>
      {/* external tooltip window shown via main process; internal tooltip removed */}
    </li>
  );
}

export default HistoryItem;