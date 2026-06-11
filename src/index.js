// src/index.js
// ─────────────────────────────────────────────────────────────
// APS Scheduler — Entry Point
// Wraps the app in AppProvider so all components have access
// to persistent Supabase state via useApp()
// ─────────────────────────────────────────────────────────────
import React from 'react';
import ReactDOM from 'react-dom/client';
import './App.css';
import App from './App';
import { AppProvider } from './context/AppContext';

const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);
