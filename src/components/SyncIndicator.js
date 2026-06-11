// src/components/SyncIndicator.js
// Small indicator in the app header showing real-time sync status
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function SyncIndicator() {
  const [status, setStatus] = useState('connecting'); // connecting | live | error

  useEffect(() => {
    // Check channel status
    const channel = supabase.channel('health_check')
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') setStatus('live');
        else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') setStatus('error');
        else setStatus('connecting');
      });

    return () => channel.unsubscribe();
  }, []);

  const config = {
    live:        { dot: '#22c55e', label: 'Live',        title: 'Real-time sync active' },
    connecting:  { dot: '#f59e0b', label: 'Connecting',  title: 'Connecting to database…' },
    error:       { dot: '#ef4444', label: 'Offline',     title: 'Connection lost — changes may not save' },
  }[status];

  return (
    <div
      title={config.title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '11px',
        color: '#888',
        cursor: 'default',
        userSelect: 'none',
        padding: '4px 8px',
        borderRadius: '20px',
        background: 'rgba(0,0,0,0.04)',
      }}
    >
      <span style={{
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        background: config.dot,
        display: 'inline-block',
        boxShadow: status === 'live' ? `0 0 0 2px ${config.dot}33` : 'none',
      }} />
      {config.label}
    </div>
  );
}
