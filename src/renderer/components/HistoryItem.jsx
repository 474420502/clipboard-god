import React, { useState } from 'react';

function HistoryItem({ item, index, previewLength = 120, customTooltip = false, showShortcuts = true }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

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

  const handleCopy = (e) => {
    e.stopPropagation();
    if (item.type === 'text' && item.content) {
      navigator.clipboard.writeText(item.content);
    }
  };

  const truncateText = (text, maxLength) => {
    if (!text) return '';
    return text.length > maxLength ? text.slice(0, maxLength - 1) + '…' : text;
  };

  const handleMouseEnter = (e) => {
    if (customTooltip && item.type === 'text') {
      setShowTooltip(true);
      setTooltipPosition({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseMove = (e) => {
    if (customTooltip && showTooltip) {
      setTooltipPosition({ x: e.clientX, y: e.clientY });
    }
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
      className="history-item"
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
            left: tooltipPosition.x + 10,
            top: tooltipPosition.y + 10,
            zIndex: 1000,
            backgroundColor: '#333',
            color: 'white',
            padding: '8px',
            borderRadius: '4px',
            maxWidth: '300px',
            wordWrap: 'break-word',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
          }}
        >
          <button className="custom-tooltip-copy" onClick={handleCopy}>Copy</button>
          <div>{item.content}</div>
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