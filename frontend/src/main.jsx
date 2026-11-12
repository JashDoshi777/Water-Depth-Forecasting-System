import React from 'react';
import ReactDOM from 'react-dom/client';
import './lib/theme';
import App from './App';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
