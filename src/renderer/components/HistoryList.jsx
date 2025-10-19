import React from 'react';
import HistoryItem from './HistoryItem';

function HistoryList({ history, previewLength, showShortcuts = true, selectedIndex = 0, keyboardNavigationMode = false, setSelectedIndex, setKeyboardNavigationMode }) {
  if (!history || history.length === 0) {
    return <div className="empty-state">No clipboard history yet</div>;
  }

  return (
    <ul className="history-list">
      {history.map((item, index) => (
        <HistoryItem
          key={item.id || index}
          item={item}
          index={index}
          previewLength={previewLength}
          showShortcuts={showShortcuts}
          isSelected={keyboardNavigationMode && index === selectedIndex}
          setSelectedIndex={setSelectedIndex}
          setKeyboardNavigationMode={setKeyboardNavigationMode}
        />
      ))}
    </ul>
  );
}

export default HistoryList;

