import React, { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { truncateText } from '../utils/text';

function HistoryItem({ item, index, previewLength = 120, showShortcuts = true, enableTooltips = true, isSelected = false, setSelectedIndex, setKeyboardNavigationMode }) {
  const itemRef = useRef(null);
  const menuRef = useRef(null);
  const { t } = useTranslation();
  // expose t into a ref so rAF callbacks can access it without violating hook rules
  const i18nRef = useRef({ t });
  // keep ref updated when t changes
  useEffect(() => { i18nRef.current.t = t; }, [t]);

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
              // respect renderer-side toggle first
              if (enableTooltips && window.electronAPI && typeof window.electronAPI.showTooltip === 'function') {
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

                if (isText) {
                  window.electronAPI.showTooltip({ content: item.content, anchorRect });
                } else {
                  // For images, send an HTML payload so the main process can render an image inside the tooltip
                  const src = item.image_path ? `file://${item.image_path}` : item.content;
                  const { t } = i18nRef.current || { t: (k) => k };
                  const html = `<div style="max-width:440px;max-height:320px;display:flex;flex-direction:column;align-items:flex-start;gap:8px;"><img src=\"${src}\" style=\"max-width:420px;max-height:280px;border-radius:6px;display:block;\" alt=\"image preview\"/><div style=\"font-size:12px;color:#ddd;\">${t('history.clickToPasteImage')}</div></div>`;
                  window.electronAPI.showTooltip({ content: html, anchorRect, html: true });
                }
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
        if (enableTooltips && window.electronAPI && typeof window.electronAPI.hideTooltip === 'function') {
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

  // Global single-instance context menu. Creates or reuses an element with id 'global-history-context-menu'.
  const handleContextMenu = (e) => {
    try {
      e.preventDefault();
      const MENU_ID = 'global-history-context-menu';

      // remove any existing hide timer on previous menu
      let menu = document.getElementById(MENU_ID);
      if (!menu) {
        menu = document.createElement('div');
        menu.id = MENU_ID;
        menu.className = 'history-context-menu';
        // base styles (CSS file will provide detailed styles)
        menu.style.position = 'fixed';
        menu.style.zIndex = 9999;
        menu.style.minWidth = '140px';
        menu.style.background = 'var(--menu-bg, #222)';
        menu.style.color = 'var(--menu-color, #fff)';
        menu.style.padding = '6px';
        menu.style.borderRadius = '6px';
        menu.style.boxShadow = '0 6px 20px rgba(0,0,0,0.6)';
        document.body.appendChild(menu);
      }

      // position
      const x = Math.max(8, Math.min(window.innerWidth - 8, e.clientX));
      const y = Math.max(8, Math.min(window.innerHeight - 8, e.clientY));
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;

      // clear previous content
      menu.innerHTML = '';

      // helper to create item
      const makeItem = (label, onClick) => {
        const el = document.createElement('div');
        el.className = 'history-context-menu-item';
        el.textContent = label;
        el.style.padding = '8px 10px';
        el.style.cursor = 'pointer';
        el.onmouseenter = () => { el.style.background = 'rgba(255,255,255,0.04)'; };
        el.onmouseleave = () => { el.style.background = 'transparent'; };
        el.onclick = (evt) => { evt.stopPropagation(); try { onClick(); } catch (err) { } hideMenu(); };
        return el;
      };

      // edit for text
      if (isText) {
        menu.appendChild(makeItem(i18nRef.current.t('history.edit') || 'Edit', async () => {
          try {
            // Dispatch a global event to open the React EditModal handled by App
            const ev = new CustomEvent('open-edit-modal', { detail: { item } });
            window.dispatchEvent(ev);
          } catch (err) { console.error('Edit dispatch error', err); }
        }));
      }

      // pin/unpin
      const pinLabel = (item.pinned ? (i18nRef.current.t('history.unpin') || 'Unpin') : (i18nRef.current.t('history.pin') || 'Pin'));
      menu.appendChild(makeItem(pinLabel, async () => {
        try {
          const dbId = item._dbId || item.id;
          const newPinned = !item.pinned;
          console.debug('[HistoryItem] pin clicked', { dbId, newPinned, item });
          // Optimistic UI: dispatch a local event so renderer can update immediately
          try {
            const ev = new CustomEvent('local-pin-toggled', { detail: { dbId, pinned: newPinned } });
            window.dispatchEvent(ev);
          } catch (e) { }

          if (window.electronAPI && typeof window.electronAPI.pinItem === 'function') {
            const res = await window.electronAPI.pinItem(dbId, newPinned);
            console.debug('[HistoryItem] pinItem result', res);
            if (!res || !res.success) {
              console.error('[HistoryItem] Pin failed', res && res.error);
              // If failed, dispatch reverse event to revert optimistic change
              try {
                const ev = new CustomEvent('local-pin-toggled', { detail: { dbId, pinned: !newPinned } });
                window.dispatchEvent(ev);
              } catch (e) { }
            } else {
              // success: rely on main process' update broadcast to reconcile state
            }
          }
        } catch (err) { console.error('Pin error', err); }
      }));

      // show menu
      menu.style.display = 'block';

      // manage single global hide timer and enter/leave behavior
      if (!menu.__hideTimer) menu.__hideTimer = null;

      const clearHideTimer = () => {
        if (menu.__hideTimer) {
          clearTimeout(menu.__hideTimer);
          menu.__hideTimer = null;
        }
      };

      const hideMenu = () => {
        try {
          menu.style.display = 'none';
          menu.innerHTML = '';
          clearHideTimer();
        } catch (e) { }
        window.removeEventListener('click', onWindowClick);
      };

      const onWindowClick = (ev) => {
        // close when clicking outside
        if (!menu.contains(ev.target)) hideMenu();
      };

      // when mouse enters, cancel hide timer
      const onMouseEnter = () => clearHideTimer();
      // when leaves, start hide timer (1s)
      const onMouseLeave = () => {
        clearHideTimer();
        menu.__hideTimer = setTimeout(() => {
          hideMenu();
        }, 1000);
      };

      // attach events (ensure no duplicate listeners)
      menu.removeEventListener('mouseenter', onMouseEnter);
      menu.removeEventListener('mouseleave', onMouseLeave);
      menu.addEventListener('mouseenter', onMouseEnter);
      menu.addEventListener('mouseleave', onMouseLeave);

      // click outside to close
      window.addEventListener('click', onWindowClick);

      // store hide function on elem for other closures
      menu.__hide = hideMenu;
    } catch (err) {
      console.error('context menu error', err);
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
      className={`history-item ${isSelected ? 'selected' : ''} ${isImage ? 'image-item' : ''} ${item.pinned ? 'pinned' : ''}`}
      onClick={handlePaste}
      onContextMenu={handleContextMenu}
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
        {isImage}
      </div>
      {isImage && (
        <div className="item-actions">
          <button type="button" className="btn btn-view" onClick={(e) => {
            e.stopPropagation();
            try {
              const p = item.image_path || '';
              if (window.electronAPI && typeof window.electronAPI.openImage === 'function') {
                window.electronAPI.openImage(p).then((res) => {
                  if (!res || !res.success) console.error('Open failed', res && res.error);
                });
              }
            } catch (err) { console.error(err); }
          }}>{t('history.view')}</button>
          <button type="button" className="btn btn-download" onClick={(e) => {
            e.stopPropagation();
            try {
              const p = item.image_path || '';
              if (window.electronAPI && typeof window.electronAPI.downloadImage === 'function') {
                window.electronAPI.downloadImage(p).then((res) => {
                  if (res && res.canceled) {
                    return;
                  }
                  if (!res || !res.success) {
                    console.error('Download failed', res && res.error);
                  } else {
                    try {
                      const { t } = i18nRef.current || { t: (k) => k };
                      const title = t('history.downloadSuccessTitle');
                      const body = t('history.downloadedMessage', { path: res.path });
                      if (window.electronAPI && typeof window.electronAPI.showNotification === 'function') {
                        window.electronAPI.showNotification(title, body);
                      }
                    } catch (err) { }
                  }
                });
              }
            } catch (err) { console.error(err); }
          }}>{t('history.download')}</button>
        </div>
      )}
      {/* external tooltip window shown via main process; internal tooltip removed */}
    </li>
  );
}

export default HistoryItem;