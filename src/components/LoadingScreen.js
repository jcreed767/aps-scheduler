// src/components/LoadingScreen.js
// Shown on first load while data is fetched from Supabase
import React from 'react';

const APS_LOGO = (
  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="48" height="48" rx="8" fill="#4466AD"/>
    <path d="M24 8L36 28H12L24 8Z" fill="#E6B43E"/>
    <rect x="18" y="30" width="12" height="10" fill="#E6B43E"/>
  </svg>
);

export default function LoadingScreen({ message = 'Loading…' }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#f8f9fb',
      gap: '20px',
      color: '#474747',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{ animation: 'aps-pulse 1.5s ease-in-out infinite' }}>
        {APS_LOGO}
      </div>
      <div style={{ fontSize: '15px', color: '#888', letterSpacing: '0.02em' }}>
        {message}
      </div>
      <style>{`
        @keyframes aps-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(0.95); }
        }
      `}</style>
    </div>
  );
}
