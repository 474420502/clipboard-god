import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import HistoryItem from './HistoryItem';

const TEXT_ITEM_HEIGHT = 52;
const IMAGE_ITEM_HEIGHT = 140;
const OVERSCAN_COUNT = 4;

function getItemHeight(item) {
  return item && item.type === 'image' ? IMAGE_ITEM_HEIGHT : TEXT_ITEM_HEIGHT;
}

function findStartIndex(offsets, scrollTop) {
  let low = 0;
  let high = offsets.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (offsets[mid] <= scrollTop) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return Math.max(0, high);
}

function HistoryList({ history, previewLength, showShortcuts = true, enableTooltips = true, selectedIndex = 0, setSelectedIndex }) {
  const { t } = useTranslation();
  const listRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const itemMeta = useMemo(() => {
    const heights = new Array(history.length);
    const offsets = new Array(history.length);
    let totalHeight = 0;
    for (let index = 0; index < history.length; index += 1) {
      heights[index] = getItemHeight(history[index]);
      offsets[index] = totalHeight;
      totalHeight += heights[index];
    }
    return { heights, offsets, totalHeight };
  }, [history]);

  useEffect(() => {
    const element = listRef.current;
    if (!element) {
      setViewportHeight(0);
      return undefined;
    }

    const updateViewportHeight = () => {
      setViewportHeight(element.clientHeight || 0);
    };

    updateViewportHeight();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateViewportHeight);
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateViewportHeight);
    return () => window.removeEventListener('resize', updateViewportHeight);
  }, [history.length]);

  useEffect(() => {
    const element = listRef.current;
    if (!element || !history.length) return;
    const itemTop = itemMeta.offsets[selectedIndex] || 0;
    const itemHeight = itemMeta.heights[selectedIndex] || TEXT_ITEM_HEIGHT;
    const itemBottom = itemTop + itemHeight;
    const viewportBottom = element.scrollTop + element.clientHeight;
    if (itemTop < element.scrollTop) {
      element.scrollTop = itemTop;
    } else if (itemBottom > viewportBottom) {
      element.scrollTop = Math.max(0, itemBottom - element.clientHeight);
    }
  }, [selectedIndex, history.length, itemMeta]);

  const { startIndex, endIndex, topSpacerHeight, bottomSpacerHeight } = useMemo(() => {
    if (!history.length) {
      return { startIndex: 0, endIndex: -1, topSpacerHeight: 0, bottomSpacerHeight: 0 };
    }

    const visibleHeight = viewportHeight || 1;
    const safeScrollTop = Math.max(0, scrollTop);
    const firstVisible = findStartIndex(itemMeta.offsets, safeScrollTop);
    let lastVisible = firstVisible;
    const viewportEnd = safeScrollTop + visibleHeight;
    while (lastVisible < history.length && (itemMeta.offsets[lastVisible] + itemMeta.heights[lastVisible]) < viewportEnd) {
      lastVisible += 1;
    }

    const visibleStart = Math.max(0, firstVisible - OVERSCAN_COUNT);
    const visibleEnd = Math.min(history.length - 1, Math.max(lastVisible, firstVisible) + OVERSCAN_COUNT);
    const top = itemMeta.offsets[visibleStart] || 0;
    const renderedHeight = history.slice(visibleStart, visibleEnd + 1).reduce((sum, item) => sum + getItemHeight(item), 0);
    const bottom = Math.max(0, itemMeta.totalHeight - top - renderedHeight);

    return {
      startIndex: visibleStart,
      endIndex: visibleEnd,
      topSpacerHeight: top,
      bottomSpacerHeight: bottom
    };
  }, [history, itemMeta, scrollTop, viewportHeight]);

  const visibleItems = useMemo(() => {
    if (endIndex < startIndex) return [];
    return history.slice(startIndex, endIndex + 1);
  }, [history, startIndex, endIndex]);

  if (!history || history.length === 0) {
    return <div className="empty-state">{t('history.empty')}</div>;
  }

  return (
    <ul
      ref={listRef}
      className="history-list"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      {topSpacerHeight > 0 ? <li className="history-spacer" style={{ height: `${topSpacerHeight}px` }} aria-hidden="true" /> : null}
      {visibleItems.map((item, visibleIndex) => {
        const index = startIndex + visibleIndex;
        return (
          <HistoryItem
            key={(item && (item._dbId || item.id)) || index}
            item={item}
            index={index}
            previewLength={previewLength}
            showShortcuts={showShortcuts}
            enableTooltips={enableTooltips}
            isSelected={index === selectedIndex}
            setSelectedIndex={setSelectedIndex}
            style={{ minHeight: `${itemMeta.heights[index]}px` }}
          />
        );
      })}
      {bottomSpacerHeight > 0 ? <li className="history-spacer" style={{ height: `${bottomSpacerHeight}px` }} aria-hidden="true" /> : null}
    </ul>
  );
}

export default HistoryList;

