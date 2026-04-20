import React, { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { truncateText } from '../utils/text';

const DEBUG = !!(import.meta && import.meta.env && import.meta.env.DEV);

function HistoryItem({ item, index, previewLength = 120, showShortcuts = true, enableTooltips = true, isSelected = false, setSelectedIndex, style = undefined }) {
  const itemRef = useRef(null);
  const { t } = useTranslation();
  // expose t into a ref so rAF callbacks can access it without violating hook rules
  const i18nRef = useRef({ t });
  // keep ref updated when t changes
  useEffect(() => { i18nRef.current.t = t; }, [t]);

  const rafId = useRef(null);
  const lastRect = useRef(null);
  const stableCount = useRef(0);
  const STABLE_FRAMES = 3;

  useEffect(() => {
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    lastRect.current = null;
    stableCount.current = 0;

    if (isSelected && itemRef.current) {
      if (!enableTooltips) {
        try {
          if (window.electronAPI && typeof window.electronAPI.hideTooltip === 'function') {
            window.electronAPI.hideTooltip();
          }
        } catch (err) { }
      }

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
            try {
              if (enableTooltips && window.electronAPI && typeof window.electronAPI.showTooltip === 'function') {
                const anchorRect = {
                  top: Math.round(rect.top),
                  left: Math.round(rect.left),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height)
                };

                if (isText) {
                  window.electronAPI.showTooltip({
                    content: item.content,
                    anchorRect,
                    preferredWidth: 880,
                    preferredHeight: 720,
                    minWidth: 380,
                    minHeight: 120,
                    preferredSide: 'right'
                  });
                } else {
                  const tooltipImagePath = item.image_path || item.image_thumb;
                  const src = tooltipImagePath ? `file://${tooltipImagePath}` : item.content;
                  const { t } = i18nRef.current || { t: (key) => key };
                  const html = `<div id="media-layout"><div id="media-wrap"><img src=\"${src}\" alt="image preview"/></div><div id="media-caption">${t('history.clickToPasteImage')}</div></div>`;
                  window.electronAPI.showTooltip({
                    content: html,
                    anchorRect,
                    html: true,
                    preferredWidth: 1040,
                    preferredHeight: 820,
                    minWidth: 420,
                    minHeight: 220,
                    preferredSide: 'right'
                  });
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
  }, [enableTooltips, isSelected, item.content, item.id, item._dbId, item.image_path, item.image_thumb]);

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

  const handleExtractQRCode = (e) => {
    try {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      const imagePath = item.image_path || item.image_thumb || '';
      const ev = new CustomEvent('open-qr-dialog', { detail: { imagePath, item } });
      window.dispatchEvent(ev);
    } catch (err) {
      console.error('Failed to request QR extraction:', err);
    }
  };

  const handleExtractOCR = (e) => {
    try {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      const imagePath = item.image_path || item.image_thumb || '';
      const ev = new CustomEvent('open-ocr-dialog', { detail: { imagePath, item } });
      window.dispatchEvent(ev);
    } catch (err) {
      console.error('Failed to request OCR extraction:', err);
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

      if (isImage) {
        menu.appendChild(makeItem(i18nRef.current.t('history.qrcode') || 'QR Code', async () => {
          try {
            handleExtractQRCode();
          } catch (err) { console.error('QR dispatch error', err); }
        }));

        menu.appendChild(makeItem(i18nRef.current.t('history.ocr') || 'OCR', async () => {
          try {
            handleExtractOCR();
          } catch (err) { console.error('OCR dispatch error', err); }
        }));
      }

      // pin/unpin
      const pinLabel = (item.pinned ? (i18nRef.current.t('history.unpin') || 'Unpin') : (i18nRef.current.t('history.pin') || 'Pin'));
      menu.appendChild(makeItem(pinLabel, async () => {
        try {
          const dbId = item._dbId || item.id;
          const newPinned = !item.pinned;
          if (DEBUG) console.debug('[HistoryItem] pin clicked', { dbId, newPinned, item });
          // Optimistic UI: dispatch a local event so renderer can update immediately
          try {
            const ev = new CustomEvent('local-pin-toggled', { detail: { dbId, pinned: newPinned } });
            window.dispatchEvent(ev);
          } catch (e) { }

          if (window.electronAPI && typeof window.electronAPI.pinItem === 'function') {
            const res = await window.electronAPI.pinItem(dbId, newPinned);
            if (DEBUG) console.debug('[HistoryItem] pinItem result', res);
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
        if (window.__historyContextMenuOnClick === onWindowClick) {
          try { window.__historyContextMenuOnClick = null; } catch (e) { }
        }
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
      if (menu.__onMouseEnter) {
        try { menu.removeEventListener('mouseenter', menu.__onMouseEnter); } catch (e) { }
      }
      if (menu.__onMouseLeave) {
        try { menu.removeEventListener('mouseleave', menu.__onMouseLeave); } catch (e) { }
      }
      menu.__onMouseEnter = onMouseEnter;
      menu.__onMouseLeave = onMouseLeave;
      menu.addEventListener('mouseenter', onMouseEnter);
      menu.addEventListener('mouseleave', onMouseLeave);

      // click outside to close
      // remove any previous global handler to prevent duplicates
      if (window.__historyContextMenuOnClick) {
        try { window.removeEventListener('click', window.__historyContextMenuOnClick); } catch (e) { }
      }
      window.__historyContextMenuOnClick = onWindowClick;
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

  // 图像显示状态管理
  const [imageError, setImageError] = React.useState(false);
  const [useMainImage, setUseMainImage] = React.useState(false);

  // 重置图像状态当item变化时
  React.useEffect(() => {
    setImageError(false);
    setUseMainImage(false);
  }, [item.id, item.image_thumb, item.image_path]);

  // 处理图像加载错误
  const handleImageError = (e) => {
    console.error('Failed to load image:', e.target.src);

    // 如果当前尝试的是缩略图且失败了，尝试主图像
    if (!useMainImage && item.image_thumb && item.image_path && item.image_path !== item.image_thumb) {
      if (DEBUG) console.log('Thumbnail failed, trying main image:', item.image_path);
      setUseMainImage(true);
      return;
    }

    // 如果主图像也失败了，隐藏图像并显示图标
    setImageError(true);
    e.target.style.display = 'none';
  };

  // 确定要使用的图像路径
  const getDisplayImagePath = () => {
    if (imageError) return null;

    if (useMainImage) {
      return item.image_path;
    }

    return imagePath;
  };

  const displayImagePath = getDisplayImagePath();

  return (
    <li
      ref={itemRef}
      className={`history-item ${isSelected ? 'selected' : ''} ${isImage ? 'image-item' : ''} ${item.pinned ? 'pinned' : ''}`}
      style={style}
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
        {isImage && displayImagePath && <img src={`file://${displayImagePath}`} alt="thumbnail" className="history-thumb" onError={handleImageError} />}
        {isImage && !displayImagePath && <span className="image-icon">I</span>}
        {shortcut}
      </div>
      <div className="item-content">
        {isText && <span className="text-preview">{displayText}</span>}
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
          <button type="button" className="btn btn-qr" onClick={handleExtractQRCode}>{t('history.qrcode')}</button>
          <button type="button" className="btn btn-ocr" onClick={handleExtractOCR}>{t('history.ocr')}</button>
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
