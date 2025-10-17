import React from 'react';
import HistoryItem from './HistoryItem';

function HistoryList({ history, previewLength, customTooltip }) {
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
          customTooltip={customTooltip}
        />
      ))}
    </ul>
  );
}

export default HistoryList;