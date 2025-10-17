import React, { useState } from 'react';

function SearchBar({ searchTerm, setSearchTerm, onAdvancedSearch, onPasteRequest }) {
  const [isAdvancedSearch, setIsAdvancedSearch] = useState(false);
  const [searchType, setSearchType] = useState('all'); // 'all', 'text', 'image'
  const [sortBy, setSortBy] = useState('time'); // 'time', 'length'
  const [suggestedPaste, setSuggestedPaste] = useState(null); // { index, label }

  const handleChange = (e) => {
    try {
      if (typeof setSearchTerm === 'function') {
        const v = e.target.value;
        setSearchTerm(v);

        // detect numeric-only input (possibly with whitespace) and suggest default paste
        const trimmed = v.trim();
        if (/^\d+$/.test(trimmed)) {
          // numeric input; compute index (convert '1'..'9' to 0..8). For multi-digit, show as number selection
          const num = parseInt(trimmed, 10);
          if (!Number.isNaN(num) && num > 0) {
            // label like "Paste #N"; index is num-1
            setSuggestedPaste({ index: num - 1, label: `Paste #${num}` });
          } else {
            setSuggestedPaste(null);
          }
        } else {
          setSuggestedPaste(null);
        }
      } else {
        console.error('setSearchTerm is not a function');
      }
    } catch (error) {
      console.error('Failed to handle search term change:', error);
    }
  };

  // handle Enter to trigger paste when suggestedPaste exists
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && suggestedPaste) {
      // try to use parent callback first, otherwise try electronAPI directly
      try {
        if (typeof onPasteRequest === 'function') {
          onPasteRequest(suggestedPaste.index);
        } else if (window.electronAPI && typeof window.electronAPI.pasteItemByIndex === 'function') {
          // some implementations may expose paste by index
          window.electronAPI.pasteItemByIndex(suggestedPaste.index);
        } else {
          // fallback: send filtered index to main via pasteItem with index-only envelope
          if (window.electronAPI && typeof window.electronAPI.pasteItem === 'function') {
            window.electronAPI.pasteItem({ __index: suggestedPaste.index });
          } else {
            console.warn('No paste API available to execute suggested paste');
          }
        }
      } catch (err) {
        console.error('Failed to execute suggested paste:', err);
      }
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

  return (
    <div className="search-box">
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <input 
          type="text" 
          id="searchInput" 
          placeholder="Search clipboard history..." 
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

      {/* suggested default action when numeric input detected */}
      {suggestedPaste && (
        <div style={{ marginTop: '8px', color: '#666', fontSize: '13px' }}>
          <span>{suggestedPaste.label}</span>
          <button
            onClick={() => {
              try {
                if (typeof onPasteRequest === 'function') {
                  onPasteRequest(suggestedPaste.index);
                } else if (window.electronAPI && typeof window.electronAPI.pasteItemByIndex === 'function') {
                  window.electronAPI.pasteItemByIndex(suggestedPaste.index);
                } else if (window.electronAPI && typeof window.electronAPI.pasteItem === 'function') {
                  window.electronAPI.pasteItem({ __index: suggestedPaste.index });
                } else {
                  console.warn('No paste API available to execute suggested paste');
                }
              } catch (err) {
                console.error('Failed to execute suggested paste:', err);
              }
            }}
            style={{ marginLeft: '10px', padding: '4px 8px', cursor: 'pointer' }}
          >
            Paste
          </button>
        </div>
      )}
    </div>
  );
}

export default SearchBar;