import React, { useRef, useEffect } from 'react';
import { truncateText } from '../utils/text';
import Tooltip from './Tooltip';

function HistoryItem({ item, index, previewLength = 120, showShortcuts = true, isSelected = false, setSelectedIndex, setKeyboardNavigationMode }) {
  const itemRef = useRef(null);

  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isSelected]);

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
      onMouseEnter={setSelectedIndex ? () => { setKeyboardNavigationMode(true); setSelectedIndex(index); } : undefined}
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
      <Tooltip content={isText ? item.content : 'Click to paste image'} visible={isSelected} />
    </li>
  );
}

export default HistoryItem;