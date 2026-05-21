import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

function SearchBar({
  searchTerm,
  setSearchTerm,
  onAdvancedSearch,
  onOpenSettings,
  visible = true,
  pinnedOnly = false,
  searchType = 'all',
  sortBy = 'time',
  onPinnedOnlyChange
}) {
  const [isAdvancedSearch, setIsAdvancedSearch] = useState(false);
  const [searchTypeDraft, setSearchTypeDraft] = useState(searchType); // 'all', 'text', 'image'
  const [sortByDraft, setSortByDraft] = useState(sortBy); // 'time', 'length'
  const inputRef = useRef(null);
  const { t } = useTranslation();

  const handleChange = (e) => {
    try {
      if (typeof setSearchTerm === 'function') {
        setSearchTerm(e.target.value);
      } else {
        console.error('setSearchTerm is not a function');
      }
    } catch (error) {
      console.error('Failed to handle search term change:', error);
    }
  };

  const handleKeyDown = (e) => {
    // Prevent up/down arrow keys from moving cursor in search input
    // These keys are used for item navigation
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      // Let the event bubble up to global handler for navigation
    }
    // Allow left/right arrow keys for cursor movement in search input
    // Other keys are handled by global keyboard listener
  };

  const handleTypeChange = (e) => {
    setSearchTypeDraft(e.target.value);
  };

  const handleSortChange = (e) => {
    setSortByDraft(e.target.value);
  };

  const toggleAdvancedSearch = () => {
    setIsAdvancedSearch(!isAdvancedSearch);
  };

  const handleOpenSettings = () => {
    if (typeof onOpenSettings === 'function') {
      onOpenSettings();
    }
  };

  const handleAdvancedSearch = () => {
    if (typeof onAdvancedSearch === 'function') {
      onAdvancedSearch({
        term: searchTerm,
        type: searchTypeDraft,
        sortBy: sortByDraft,
        pinnedOnly: !!pinnedOnly
      });
    }
  };

  useEffect(() => {
    setSearchTypeDraft(searchType || 'all');
  }, [searchType]);

  useEffect(() => {
    setSortByDraft(sortBy || 'time');
  }, [sortBy]);

  // 仅在搜索框可见性变化时处理焦点，避免与用户输入冲突
  useEffect(() => {
    if (inputRef.current && visible) {
      // 仅在搜索框首次显示或从隐藏状态变为显示时设置焦点
      // 不干预用户已经聚焦的输入框
      try {
        if (document.activeElement !== inputRef.current) {
          inputRef.current.focus();
        }
      } catch (err) {
        // ignore focus errors
      }
    }
  }, [visible]); // 仅响应可见性变化

  if (!visible) return null;

  return (
    <div className="search-box">
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <input
          ref={inputRef}
          type="text"
          id="searchInput"
          placeholder={t('search.placeholder')}
          value={searchTerm || ''}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          style={{ flex: 1 }}
        />
        <button
          onClick={toggleAdvancedSearch}
          style={{
            background: 'transparent',
            border: '1px solid #ddd',
            borderRadius: '4px',
            padding: '10px',
            cursor: 'pointer'
          }}
          title={t('search.advanced.toggle')}
        >
          🔎
        </button>
        <button
          onClick={handleOpenSettings}
          style={{
            background: 'transparent',
            border: '1px solid #ddd',
            borderRadius: '4px',
            padding: '10px',
            cursor: 'pointer'
          }}
          title={t('settings.title')}
        >
          ⚙️
        </button>
      </div>

      {isAdvancedSearch && (
        <div style={{
          marginTop: '10px',
          padding: '10px',
          backgroundColor: '#f8f9fa',
          borderRadius: '4px',
          animation: 'fadeIn 0.3s ease-in'
        }}>
          <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <label style={{ marginRight: '5px' }}>{t('search.advanced.typeLabel')}</label>
              <select value={searchTypeDraft} onChange={handleTypeChange}>
                <option value="all">{t('search.advanced.types.all')}</option>
                <option value="text">{t('search.advanced.types.text')}</option>
                <option value="image">{t('search.advanced.types.image')}</option>
              </select>
            </div>

            <div>
              <label style={{ marginRight: '5px' }}>{t('search.advanced.sortLabel')}</label>
              <select value={sortByDraft} onChange={handleSortChange}>
                <option value="time">{t('search.advanced.sortOptions.time')}</option>
                <option value="length">{t('search.advanced.sortOptions.length')}</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                id="pinnedOnly"
                type="checkbox"
                checked={!!pinnedOnly}
                onChange={(e) => {
                  if (typeof onPinnedOnlyChange === 'function') {
                    onPinnedOnlyChange(e.target.checked);
                  }
                }}
              />
              <label htmlFor="pinnedOnly">{t('search.advanced.onlyPinned') || 'Only pinned'}</label>
            </div>

            <button
              className="btn-primary"
              onClick={handleAdvancedSearch}
              style={{ marginLeft: 'auto' }}
            >
              {t('search.advanced.apply')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SearchBar;
