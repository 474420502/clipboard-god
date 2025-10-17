import React, { useState, useEffect, useRef } from 'react';

function SearchBar({ searchTerm, setSearchTerm, onAdvancedSearch, visible = true }) {
  const [isAdvancedSearch, setIsAdvancedSearch] = useState(false);
  const [searchType, setSearchType] = useState('all'); // 'all', 'text', 'image'
  const [sortBy, setSortBy] = useState('time'); // 'time', 'length'
  const inputRef = useRef(null);

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
          placeholder="Search clipboard history..."
          value={searchTerm || ''}
          onChange={handleChange}
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
              <label style={{ marginRight: '5px' }}>Type:</label>
              <select value={searchType} onChange={handleTypeChange}>
                <option value="all">All</option>
                <option value="text">Text</option>
                <option value="image">Image</option>
              </select>
            </div>

            <div>
              <label style={{ marginRight: '5px' }}>Sort by:</label>
              <select value={sortBy} onChange={handleSortChange}>
                <option value="time">Time</option>
                <option value="length">Length</option>
              </select>
            </div>

            <button
              className="btn-primary"
              onClick={handleAdvancedSearch}
              style={{ marginLeft: 'auto' }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SearchBar;