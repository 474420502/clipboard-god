import React from 'react';

function Header({ onScreenshot, onOpenSettings }) {
  const handleScreenshot = () => {
    try {
      if (typeof onScreenshot === 'function') {
        onScreenshot();
      } else {
        console.error('onScreenshot is not a function');
      }
    } catch (error) {
      console.error('Failed to handle screenshot:', error);
    }
  };

  const handleOpenSettings = () => {
    try {
      if (typeof onOpenSettings === 'function') {
        onOpenSettings();
      } else {
        console.error('onOpenSettings is not a function');
      }
    } catch (error) {
      console.error('Failed to open settings:', error);
    }
  };

  return (
    <div className="header">
      <h1>Clipboard God</h1>
      <div className="toolbar">
        <button id="screenshotBtn" onClick={handleScreenshot}>Screenshot</button>
        <button id="settingsBtn" onClick={handleOpenSettings}>Settings</button>
      </div>
    </div>
  );
}

export default Header;