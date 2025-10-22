import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

function SearchBar({ searchTerm, setSearchTerm, onAdvancedSearch, visible = true }) {
  const [isAdvancedSearch, setIsAdvancedSearch] = useState(false);
  const [searchType, setSearchType] = useState('all'); // 'all', 'text', 'image'
  const [sortBy, setSortBy] = useState('time'); // 'time', 'length'
  const [pinnedOnly, setPinnedOnly] = useState(false);
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
    setSearchType(e.target.value);
  };

  const handleSortChange = (e) => {
    setSortBy(e.target.value);
  };

  const toggleAdvancedSearch = () => {
    setIsAdvancedSearch(!isAdvancedSearch);
  };

  const handleAdvancedSearch = () => {
    if (typeof onAdvancedSearch === 'function') {
      onAdvancedSearch({
        term: searchTerm,
        type: searchType,
        sortBy: sortBy
        , pinnedOnly: pinnedOnly
      });
    }
  };
  // If not visible, don't render anything
  useEffect(() => {
    if (visible && inputRef.current) {
      try {
        inputRef.current.focus();
        // put caret at end
        const val = inputRef.current.value || '';
        inputRef.current.setSelectionRange(val.length, val.length);
      } catch (err) {
        // ignore focus errors
      }
    }
  }, [visible]);

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
              <select value={searchType} onChange={handleTypeChange}>
                <option value="all">{t('search.advanced.types.all')}</option>
                <option value="text">{t('search.advanced.types.text')}</option>
                <option value="image">{t('search.advanced.types.image')}</option>
              </select>
            </div>

            <div>
              <label style={{ marginRight: '5px' }}>{t('search.advanced.sortLabel')}</label>
              <select value={sortBy} onChange={handleSortChange}>
                <option value="time">{t('search.advanced.sortOptions.time')}</option>
                <option value="length">{t('search.advanced.sortOptions.length')}</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input id="pinnedOnly" type="checkbox" checked={pinnedOnly} onChange={(e) => setPinnedOnly(e.target.checked)} />
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