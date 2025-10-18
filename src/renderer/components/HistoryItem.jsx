import React, { useState } from 'react';
import { truncateText } from '../utils/text';

function HistoryItem({ item, index, previewLength = 120, customTooltip = false, showShortcuts = true, isSelected = false }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const itemRef = React.useRef(null);

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

  const handleCopy = async (e) => {
    e.stopPropagation();
    if (item.type === 'text' && item.content) {
      try {
        await navigator.clipboard.writeText(item.content);
        // Optional: Add visual feedback that copy was successful
        console.log('Text copied to clipboard');
      } catch (error) {
        console.error('Failed to copy text to clipboard:', error);
        // Fallback for older browsers or restricted contexts
        try {
          const textArea = document.createElement('textarea');
          textArea.value = item.content;
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
          console.log('Text copied to clipboard (fallback method)');
        } catch (fallbackError) {
          console.error('Fallback copy method also failed:', fallbackError);
        }
      }
    }
  };


  const handleMouseEnter = (e) => {
    if (customTooltip && item.type === 'text' && itemRef.current) {
      setShowTooltip(true);
      // Position tooltip relative to the history item element
      const rect = itemRef.current.getBoundingClientRect();
      setTooltipPosition({
        x: rect.left + rect.width / 2, // Center horizontally
        y: rect.top - 10 // Above the item
      });
    }
  };

  const handleMouseMove = (e) => {
    // No longer needed since we position relative to the element
  };

  const handleMouseLeave = () => {
    if (customTooltip) {
      setShowTooltip(false);
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
      title={isText && !customTooltip ? item.content : (isText ? 'Click to paste text' : 'Click to paste image')}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {customTooltip && showTooltip && isText && (
        <div
          className="custom-tooltip"
          style={{
            position: 'fixed',
            left: tooltipPosition.x,
            top: tooltipPosition.y,
            transform: 'translate(-50%, -100%)', // Center horizontally and position above
            zIndex: 1000,
            backgroundColor: '#333',
            color: 'white',
            padding: '8px',
            borderRadius: '4px',
            maxWidth: '300px',
            wordWrap: 'break-word',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            pointerEvents: 'auto' // Ensure tooltip can receive click events
          }}
        >
          <button
            className="custom-tooltip-copy"
            onClick={handleCopy}
            style={{
              background: '#555',
              color: 'white',
              border: 'none',
              padding: '4px 8px',
              borderRadius: '3px',
              cursor: 'pointer',
              marginBottom: '4px',
              fontSize: '12px'
            }}
          >
            Copy
          </button>
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>{item.content}</div>
        </div>
      )}

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
    </li>
  );
}

export default HistoryItem;