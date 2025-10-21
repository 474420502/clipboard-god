import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css'; // 导入样式
import i18next from './i18n';
import { I18nextProvider } from 'react-i18next';

function AppWrapper() {
  const [isI18nReady, setIsI18nReady] = useState(false);

  useEffect(() => {
    // Wait for i18next to be ready
    const checkI18nReady = () => {
      if (i18next.isInitialized) {
        setIsI18nReady(true);
      } else {
        // Check again in a short delay
        setTimeout(checkI18nReady, 50);
      }
    };
    checkI18nReady();
  }, []);

  if (!isI18nReady) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontFamily: 'Arial, sans-serif'
      }}>
        Loading...
      </div>
    );
  }

  return (
    <I18nextProvider i18n={i18next}>
      <App />
    </I18nextProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppWrapper />
  </React.StrictMode>
);
