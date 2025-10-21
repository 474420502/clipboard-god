import React from 'react';
import { useTranslation } from 'react-i18next';
import HistoryItem from './HistoryItem';

function HistoryList({ history, previewLength, showShortcuts = true, enableTooltips = true, selectedIndex = 0, keyboardNavigationMode = false, setSelectedIndex, setKeyboardNavigationMode }) {
  const { t } = useTranslation();
  if (!history || history.length === 0) {
    return <div className="empty-state">{t('history.empty')}</div>;
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
          enableTooltips={enableTooltips}
          isSelected={index === selectedIndex}
          setSelectedIndex={setSelectedIndex}
          setKeyboardNavigationMode={setKeyboardNavigationMode}
        />
      ))}
    </ul>
  );
}

export default HistoryList;

