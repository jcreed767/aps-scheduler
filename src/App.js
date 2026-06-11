import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useApp } from './context/AppContext';
import * as XLSX from 'xlsx';
import { format, parseISO, getDay, addDays } from 'date-fns';
import {
  generateRotation, analyzeCoverage, getManagerSummary,
  getAllDates, getDateKey, DOW_LABELS,
  parseForecastFile, parseHourlyFile,
  PEAK_DAYS, HIGH_DEMAND_DAYS,
} from './utils/schedulingEngine';

// ─── Inline Logo ──────────────────────────────────────────────
const APS_LOGO = `<svg id="Layer_1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 417.75 77.81"><defs><style>.cls-1{fill:#474747;}.cls-2{fill:#e6b43e;}.cls-3{fill:#4466ad;}</style></defs><path class="cls-1" d="M111.68,27.89h-15.52l-2.96,7.58h-6.07L101.11.65h5.37l14.4,34.82h-6.19l-3.01-7.58ZM98.13,22.78h11.56l-5.82-14.68-5.74,14.68Z"/><polygon class="cls-1" points="146.2 30.14 146.2 35.47 126.01 35.47 126.01 .65 131.72 .65 131.72 30.14 146.2 30.14"/><polygon class="cls-1" points="171.87 30.14 171.87 35.47 151.68 35.47 151.68 .65 157.4 .65 157.4 30.14 171.87 30.14"/><rect class="cls-1" x="172.46" y="18.88" width="15.96" height="5.33"/><path class="cls-1" d="M220.85,12.15c0,6.57-5.09,11.5-11.87,11.5h-7.16v11.82h-5.72V.65h12.87c6.75,0,11.87,4.89,11.87,11.5M215.03,12.15c0-3.5-2.61-6.08-6.33-6.08h-6.88v12.15h6.88c3.72,0,6.33-2.58,6.33-6.08"/><path class="cls-1" d="M226.32,22.45V.65h5.75v21.44c0,5.14,3.42,8.53,8.24,8.53s8.21-3.39,8.21-8.53V.65h5.75v21.79c0,8.03-5.97,13.68-13.96,13.68s-13.99-5.65-13.99-13.68"/><path class="cls-1" d="M275.09,22.59h-6.6v12.88h-5.71V.65h13.55c6.71,0,11.7,4.59,11.7,11.02,0,4.75-2.83,8.53-7.08,10.11l8.04,13.69h-6.41l-7.48-12.88ZM268.48,17.24h7.51c3.78,0,6.22-2.34,6.22-5.62s-2.44-5.62-6.22-5.62h-7.51v11.23Z"/><path class="cls-1" d="M319.9,12.15c0,6.57-5.09,11.5-11.87,11.5h-7.16v11.82h-5.71V.65h12.87c6.75,0,11.87,4.89,11.87,11.5M314.08,12.15c0-3.5-2.61-6.08-6.33-6.08h-6.88v12.15h6.88c3.72,0,6.33-2.58,6.33-6.08"/><path class="cls-1" d="M323.51,18.06c0-10.31,7.8-18.06,18.37-18.06s18.34,7.74,18.34,18.06-7.78,18.06-18.34,18.06-18.37-7.75-18.37-18.06M354.41,18.06c0-7.19-5.35-12.56-12.53-12.56s-12.56,5.42-12.56,12.56,5.38,12.56,12.56,12.56,12.53-5.38,12.53-12.56"/><path class="cls-1" d="M364.58,24.51h5.8c0,3.89,3.2,6.04,7.28,6.04,3.71,0,6.87-1.95,6.87-5.15,0-3.46-3.73-4.33-7.93-5.32-5.33-1.3-11.44-2.77-11.44-9.95,0-6.28,4.76-9.99,12.18-9.99s12.02,4.12,12.02,10.68h-5.65c0-3.47-2.87-5.35-6.5-5.35s-6.34,1.59-6.34,4.42c0,3.22,3.58,4.09,7.72,5.08,5.41,1.34,11.79,2.89,11.79,10.38,0,6.97-5.62,10.67-12.67,10.67-7.81,0-13.13-4.38-13.13-11.5"/><polygon class="cls-1" points="417.75 30.07 417.75 35.47 396.99 35.47 396.99 .65 417.21 .65 417.21 6 402.7 6 402.7 15.1 415.92 15.1 415.92 20.33 402.7 20.33 402.7 30.07 417.75 30.07"/><path class="cls-1" d="M85.66,65.69h9.89c0,2.49,1.92,3.7,4.11,3.7,2.01,0,3.93-1.07,3.93-2.97,0-2.19-2.71-2.82-6.03-3.62-5.03-1.25-11.45-2.79-11.45-10.72,0-6.85,5.04-10.78,13.25-10.78s13.13,4.29,13.13,11.37h-9.62c0-2.2-1.64-3.23-3.63-3.23-1.71,0-3.35.74-3.35,2.37,0,1.98,2.62,2.63,5.9,3.46,5.13,1.32,11.82,3.03,11.82,10.98s-5.84,11.55-13.93,11.55c-8.52,0-14.03-4.51-14.03-12.1"/><polygon class="cls-1" points="144.06 50.75 134.6 50.75 134.6 76.93 124.96 76.93 124.96 50.75 115.51 50.75 115.51 42.11 144.06 42.11 144.06 50.75"/><path class="cls-1" d="M145.63,59.52c0-10.64,7.99-18.29,19.18-18.29s19.12,7.62,19.12,18.29-7.96,18.29-19.12,18.29-19.18-7.65-19.18-18.29M173.94,59.52c0-5.45-3.84-9.36-9.14-9.36s-9.19,3.94-9.19,9.36,3.89,9.36,9.19,9.36,9.14-3.92,9.14-9.36"/><path class="cls-1" d="M201.91,66.27h-3.48v10.65h-9.59v-34.82h15.09c7.51,0,12.95,5.04,12.95,12.32,0,4.27-2.09,7.77-5.52,9.83l6.91,12.66h-10.7l-5.65-10.65ZM198.43,58.19h4.38c2.68,0,4.22-1.61,4.22-3.79s-1.54-3.77-4.22-3.77h-4.38v7.56Z"/><path class="cls-1" d="M243.5,71.27h-12.34l-1.93,5.66h-10.28l13.68-34.82h9.37l13.98,34.82h-10.56l-1.92-5.66ZM237.31,52.98l-3.82,10.79h7.67l-3.85-10.79Z"/><path class="cls-1" d="M292.79,58.32c0,11.39-7.44,19.49-18.34,19.49s-18.55-7.67-18.55-18.26,7.74-18.32,18.46-18.32c9.12,0,16.59,5.71,18.06,13.8h-10.05c-1.26-2.93-4.37-4.82-7.93-4.82-5.21,0-8.73,3.77-8.73,9.33s3.46,9.28,8.73,9.28c3.66,0,6.8-1.77,7.9-4.46h-8.65v-6.05h19.09Z"/><polygon class="cls-1" points="320.34 68.61 320.34 76.93 297.64 76.93 297.64 42.11 319.92 42.11 319.92 50.4 307.19 50.4 307.19 55.53 318.63 55.53 318.63 63.4 307.19 63.4 307.19 68.61 320.34 68.61"/><path class="cls-2" d="M10.44,11.09h50.81c1.25,0,2.45-.5,3.33-1.38l7.52-7.52c.57-.57.17-1.54-.64-1.54H9.02C4.04.65,0,4.69,0,9.67v62.44c0,.8.97,1.21,1.54.64l7.52-7.52c.88-.88,1.38-2.08,1.38-3.33V11.09Z"/><path class="cls-3" d="M66.15,16v50.81H15.35c-1.25,0-2.45.5-3.33,1.38l-7.52,7.52c-.57.57-.17,1.54.64,1.54h62.44c4.98,0,9.02-4.04,9.02-9.02V5.78c0-.8-.97-1.21-1.54-.64l-7.52,7.52c-.88.88-1.38,2.08-1.38,3.33"/></svg>`;

// ─── Default Data ─────────────────────────────────────────────
const DEFAULT_START = '2026-06-05';
const DEFAULT_END   = '2026-07-31';

const mkManagers = (n, role, team) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${team}-${i+1}`, name: `${role} ${i+1}`, role,
    team, sites: '', shiftAnchor: null, unavailable: [], rotationOffset: undefined,
  }));

const INIT_STATE = {
  callCenter:  mkManagers(14, 'Site Manager', 'cc'),
  sales:       mkManagers(3,  'Sales Rep',    'sales'),
  collections: mkManagers(4,  'Collections',  'col'),
  districts:   mkManagers(3,  'District Leader', 'dl'),
};

const TEAM_META = {
  callCenter:  { label: 'Call Center',      color: '#4F8EF7', dot: '#4F8EF7', icon: '📞' },
  sales:       { label: 'Sales Team',       color: '#34D399', dot: '#34D399', icon: '💼' },
  collections: { label: 'Collections',      color: '#F87171', dot: '#F87171', icon: '📋' },
  districts:   { label: 'District Leaders', color: '#E6B43E', dot: '#E6B43E', icon: '⭐' },
};

// ─── Helpers ──────────────────────────────────────────────────
function ShiftBadge({ shift }) {
  if (!shift || shift === 'OFF') return <span className="shift-badge shift-off">OFF</span>;
  return <span className={`shift-badge shift-${shift.toLowerCase()}`}>{shift}</span>;
}

function MemberAvatar({ name, size = 40 }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  return (
    <div className="member-avatar" style={{ width: size, height: size, fontSize: size * 0.35 }}>
      {initials}
    </div>
  );
}

// ─── NAV ITEMS ────────────────────────────────────────────────
const NAV = [
  { id: 'dashboard',   label: 'Dashboard',        icon: '⬛', section: 'main' },
  { id: 'cc-schedule', label: 'Schedule Grid',     icon: '📅', section: 'cc' },
  { id: 'cc-coverage', label: 'Coverage Analysis', icon: '📊', section: 'cc' },
  { id: 'cc-summary',  label: 'Manager Summary',   icon: '👥', section: 'cc' },
  { id: 'cc-forecast', label: 'Forecast & Data',   icon: '📈', section: 'cc' },
  { id: 'sales',       label: 'Sales Team',        icon: '💼', section: 'sales' },
  { id: 'collections', label: 'Collections',       icon: '📋', section: 'col' },
  { id: 'districts',   label: 'District Leaders',  icon: '⭐', section: 'dl' },
  { id: 'settings',    label: 'Settings',          icon: '⚙️',  section: 'config' },
];

const SECTION_LABELS = {
  main:   'Overview',
  cc:     'Call Center',
  sales:  'Sales Team',
  col:    'Collections',
  dl:     'District Leaders',
  config: 'Configuration',
};

// ─── MAIN APP ─────────────────────────────────────────────────
export default function App() {
  // ── Supabase context ──
  const {
    members,
    addMember: dbAddMember,
    updateMember: dbUpdateMember,
    removeMember: dbRemoveMember,
    loading,
  } = useApp();

  // ── Local UI state ──
  const [page, setPage]             = useState('dashboard');
  const [teams, setTeams]           = useState(INIT_STATE);
  const [startDate]                 = useState(DEFAULT_START);
  const [endDate]                   = useState(DEFAULT_END);
  const [forecastData, setForecast] = useState({});
  const [hourlyData, setHourly]     = useState([]);
  const [overrides, setOverrides]   = useState({});
  const [schedule, setSchedule]     = useState(null);
  const [generated, setGenerated]   = useState(false);
  const [editCell, setEditCell]     = useState(null);
  const [viewMode, setViewMode]     = useState('today');
  const [motm, setMotm]             = useState({ name: '', role: '', photo: null });
  const [mascot, setMascot]         = useState(null);
  const [manualSchedules, setManualSchedules] = useState({ sales: {}, collections: {}, districts: {} });

  const forecastRef = useRef();
  const hourlyRef   = useRef();
  const motmRef     = useRef();
  const mascotRef   = useRef();

  // ── Merge Supabase members with local fallback ──
  const teamsFromDB = {
    callCenter:  members.callcenter  || [],
    sales:       members.sales       || [],
    collections: members.collections || [],
    districts:   members.districts   || [],
  };
  const hasDBData = teamsFromDB.callCenter.length > 0 || teamsFromDB.sales.length > 0;
  const activeTeams = hasDBData ? teamsFromDB : teams;

  const dates = useMemo(() => getAllDates(startDate, endDate), [startDate, endDate]);

  // ── Generate CC schedule ──
  const handleGenerate = useCallback(() => {
    const s = generateRotation(activeTeams.callCenter, startDate, endDate, overrides);
    setSchedule(s); setGenerated(true);
  }, [activeTeams.callCenter, startDate, endDate, overrides]);

  const coverage = useMemo(() => {
    if (!schedule) return {};
    return analyzeCoverage(schedule, activeTeams.callCenter, forecastData);
  }, [schedule, activeTeams.callCenter, forecastData]);

  const managerSummary = useMemo(() => {
    if (!schedule) return [];
    return getManagerSummary(schedule, activeTeams.callCenter);
  }, [schedule, activeTeams.callCenter]);

  // ── Cell edit ──
  const handleCellChange = (dateKey, managerId, newShift) => {
    const updated = { ...overrides, [dateKey]: { ...(overrides[dateKey]||{}), [managerId]: newShift }};
    setOverrides(updated);
    if (schedule) setSchedule(p => ({ ...p, [dateKey]: { ...p[dateKey], [managerId]: newShift }}));
    setEditCell(null);
  };

  // ── Manual schedule cell (sales/col/dl) ──
  const setManualCell = (teamKey, dateKey, memberId, val) => {
    setManualSchedules(p => ({
      ...p,
      [teamKey]: { ...p[teamKey], [dateKey]: { ...(p[teamKey][dateKey]||{}), [memberId]: val }}
    }));
  };

  // ── Local edits buffer (optimistic UI for text inputs) ──
  const [localEdits, setLocalEdits] = useState({});
  const saveTimers = useRef({});

  // ── Team updaters (optimistic local + debounced Supabase save) ──
  const updateMember = (teamKey, id, field, value) => {
    // 1. Update local buffer immediately so input feels responsive
    setLocalEdits(p => ({
      ...p,
      [id]: { ...(p[id] || {}), [field]: value }
    }));

    // 2. Debounce the Supabase write (500ms after last keystroke)
    const timerKey = `${id}_${field}`;
    if (saveTimers.current[timerKey]) clearTimeout(saveTimers.current[timerKey]);
    saveTimers.current[timerKey] = setTimeout(() => {
      const dbField = field === 'shiftAnchor' ? 'shift_anchor'
                    : field === 'rotationOffset' ? 'rotation_offset'
                    : field;
      dbUpdateMember(id, { [dbField]: value });
    }, 500);
  };

  const addMember = (teamKey, role) => {
    const teamMap = { callCenter: 'callcenter', sales: 'sales', collections: 'collections', districts: 'districts' };
    dbAddMember({
      name: `New ${role}`,
      role,
      team: teamMap[teamKey] || teamKey,
      sites: '',
      shift_anchor: null,
      rotation_offset: 0,
      active: true,
    });
  };

  const removeMember = (teamKey, id) => {
    // Clear any pending saves for this member
    Object.keys(saveTimers.current).forEach(k => {
      if (k.startsWith(id)) clearTimeout(saveTimers.current[k]);
    });
    setLocalEdits(p => { const n = {...p}; delete n[id]; return n; });
    dbRemoveMember(id, teamKey);
  };

  // ── Helper: get member field value (local edit buffer takes priority) ──
  const getMemberValue = (m, field) => {
    if (localEdits[m.id] && localEdits[m.id][field] !== undefined) {
      return localEdits[m.id][field];
    }
    return m[field] ?? m[field === 'shiftAnchor' ? 'shift_anchor' : field === 'rotationOffset' ? 'rotation_offset' : field] ?? '';
  };

  // ── File uploads ──
  const handleForecastUpload = e => {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = evt => { const wb = XLSX.read(evt.target.result, {type:'binary'}); setForecast(parseForecastFile(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]))); };
    r.readAsBinaryString(file);
  };
  const handleHourlyUpload = e => {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = evt => { const wb = XLSX.read(evt.target.result, {type:'binary'}); setHourly(parseHourlyFile(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]))); };
    r.readAsBinaryString(file);
  };
  const handleMotmPhoto = e => {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = evt => setMotm(p => ({...p, photo: evt.target.result}));
    r.readAsDataURL(file);
  };
  const handleMascotUpload = e => {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = evt => setMascot(evt.target.result);
    r.readAsDataURL(file);
  };

  // ── Export ──
  const handleExport = () => {
    if (!schedule) return;
    const wb = XLSX.utils.book_new();
    const gridRows = [['Date','Day','DOW',...activeTeams.callCenter.map(m=>m.name),'A','B','C','Total','Meets Target','Forecast']];
    dates.forEach(date => {
      const dk = getDateKey(date); const ds = schedule[dk]||{}; const cov = coverage[dk]||{};
      gridRows.push([dk,format(date,'MMM d'),DOW_LABELS[getDay(date)],...activeTeams.callCenter.map(m=>ds[m.id]||'OFF'),cov.counts?.A||0,cov.counts?.B||0,cov.counts?.C||0,cov.totalWorking||0,cov.meetsTarget?'Yes':'No',cov.forecastCalls||'']);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(gridRows), 'CC Schedule');
    const sumRows = [['Manager','Role','Sites','Shift A','Shift B','Shift C','Total','Days Off']];
    managerSummary.forEach(s => {
      const m = activeTeams.callCenter.find(x=>x.id===s.id);
      sumRows.push([s.name,m?.role||'',m?.sites||'',s.A,s.B,s.C,s.total,s.OFF]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sumRows), 'Manager Summary');
    XLSX.writeFile(wb, `APS-schedule-${startDate}-to-${endDate}.xlsx`);
  };

  // ── Coverage gap list (for dashboard) ──
  const gapDays = useMemo(() => {
    return Object.entries(coverage)
      .filter(([,c]) => !c.meetsTarget || c.isPeak || c.isHighDemand)
      .sort(([a],[b]) => a.localeCompare(b))
      .slice(0, 8);
  }, [coverage]);

  // ── Today's staffing snapshot ──
  const today = format(new Date(), 'yyyy-MM-dd');
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');

  function getDaySnapshot(dateKey, teamKey) {
    if (teamKey === 'callCenter') {
      const ds = schedule?.[dateKey] || {};
      return activeTeams.callCenter.filter(m => ds[m.id] && ds[m.id] !== 'OFF').map(m => ({ ...m, shift: ds[m.id] }));
    }
    const teamKey2 = teamKey === 'sales' ? 'sales' : teamKey === 'collections' ? 'collections' : 'districts';
    const ms = manualSchedules[teamKey2]?.[dateKey] || {};
    return activeTeams[teamKey].filter(m => ms[m.id] && ms[m.id] !== 'OFF').map(m => ({ ...m, shift: ms[m.id] }));
  }

  // ── Loading state ──
  if (loading.members) {
    return (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',flexDirection:'column',gap:16,fontFamily:'Inter,system-ui,sans-serif',color:'#474747'}}>
        <div style={{fontSize:32}}>⏳</div>
        <div>Loading APS Scheduler…</div>
      </div>
    );
  }

  const sections = [...new Set(NAV.map(n => n.section))];

  return (
    <div className="app-shell">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div style={{lineHeight:0}} dangerouslySetInnerHTML={{__html: APS_LOGO}} />
        </div>
        <nav className="sidebar-nav">
          {sections.map(sec => (
            <div key={sec}>
              <div className="nav-section-label">{SECTION_LABELS[sec]}</div>
              {NAV.filter(n => n.section === sec).map(n => {
                const gapCount = n.id === 'cc-coverage' ? Object.values(coverage).filter(c=>!c.meetsTarget).length : 0;
                return (
                  <button
                    key={n.id}
                    className={`nav-item ${page === n.id ? 'active' : ''}`}
                    onClick={() => setPage(n.id)}
                  >
                    <span className="nav-icon">{n.icon}</span>
                    {n.label}
                    {gapCount > 0 && <span className="nav-badge">{gapCount}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* ── Main ── */}
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <span className="topbar-title">
              {NAV.find(n=>n.id===page)?.icon} {NAV.find(n=>n.id===page)?.label || 'Dashboard'}
            </span>
            <span className="topbar-sub">
              {format(new Date(), 'EEEE, MMMM d, yyyy')}
            </span>
          </div>
          <div className="topbar-right">
            {(page === 'cc-schedule' || page === 'dashboard') && (
              <button className="btn btn-primary" onClick={handleGenerate}>⚡ Generate Schedule</button>
            )}
            {generated && (
              <button className="btn btn-secondary" onClick={handleExport}>↓ Export</button>
            )}
          </div>
        </header>

        <div className="page-content">

          {/* DASHBOARD */}
          {page === 'dashboard' && (
            <div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
                <h2 className="section-title" style={{margin:0}}>Operations Overview</h2>
                <div className="view-tabs">
                  {['today','tomorrow','week','month'].map(v => (
                    <button key={v} className={`view-tab ${viewMode===v?'active':''}`} onClick={()=>setViewMode(v)}>
                      {v.charAt(0).toUpperCase()+v.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="dashboard-grid">
                <div className="dash-card span-2">
                  <div className="dash-card-title">
                    <span>Team Coverage – {viewMode === 'today' ? format(new Date(),'MMM d') : viewMode === 'tomorrow' ? format(addDays(new Date(),1),'MMM d') : viewMode}</span>
                  </div>
                  {(['callCenter','sales','collections','districts']).map(tk => {
                    const dk = viewMode === 'tomorrow' ? tomorrow : today;
                    const onShift = getDaySnapshot(dk, tk);
                    const meta = TEAM_META[tk];
                    return (
                      <div key={tk} style={{marginBottom:16}}>
                        <div className="team-coverage-item" style={{marginBottom:6}}>
                          <span className="dot" style={{background:meta.dot}} />
                          <span className="team-name-label">{meta.label}</span>
                          <span className="team-staff-count">{onShift.length} / {activeTeams[tk].length} on shift</span>
                        </div>
                        <div className="on-shift-strip">
                          {onShift.length === 0
                            ? <span style={{fontSize:12,color:'var(--text-muted)'}}>No schedule data for this date</span>
                            : onShift.map(m => (
                              <div key={m.id} className="on-shift-chip">
                                <MemberAvatar name={m.name} size={22} />
                                {m.name.split(' ').slice(-1)[0]}
                                {m.shift && m.shift !== 'ON' && (
                                  <span className={`chip-shift shift-${m.shift.toLowerCase()}`}>{m.shift}</span>
                                )}
                              </div>
                            ))
                          }
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="dash-card span-2">
                  <div className="dash-card-title">
                    <span>Coverage Alerts</span>
                    <span style={{fontSize:11,color:'var(--text-muted)'}}>{gapDays.length} items</span>
                  </div>
                  {!generated ? (
                    <p style={{fontSize:12,color:'var(--text-muted)'}}>Generate the Call Center schedule to see coverage alerts.</p>
                  ) : gapDays.length === 0 ? (
                    <div className="all-clear">✅ No coverage gaps detected</div>
                  ) : (
                    <div className="gap-alert-list">
                      {gapDays.map(([dk, c]) => {
                        const date = parseISO(dk);
                        return (
                          <div key={dk} className={`gap-alert-item ${c.isPeak?'':'warn'}`}>
                            <span className="gap-alert-date">{format(date,'MMM d')}</span>
                            <span style={{fontSize:11,color:'var(--text-muted)'}}>{DOW_LABELS[getDay(date)]}</span>
                            <span className="gap-alert-desc">
                              {c.forecastCalls ? `${c.forecastCalls.toLocaleString()} calls · ` : ''}
                              {c.counts ? `${c.counts.A}A/${c.counts.B}B/${c.counts.C}C (target ${c.target?.A}A/${c.target?.B}B/${c.target?.C}C)` : ''}
                            </span>
                            <span className={`gap-alert-badge ${c.isPeak?'badge-peak':c.isHighDemand?'badge-high':'badge-gap'}`}>
                              {c.isPeak ? 'PEAK' : c.isHighDemand ? 'HIGH' : 'GAP'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="dash-card spotlight">
                  <div className="dash-card-title"><span className="gold">⭐ Spotlights</span></div>
                  <div className="spotlight-inner">
                    <div className="spotlight-card">
                      <div className="spotlight-label">Team Member of the Month</div>
                      <label style={{cursor:'pointer'}} onClick={()=>motmRef.current?.click()}>
                        {motm.photo
                          ? <img src={motm.photo} alt="MOTM" className="spotlight-avatar" />
                          : <div className="spotlight-avatar-placeholder">🏆</div>
                        }
                      </label>
                      <input ref={motmRef} type="file" accept="image/*" onChange={handleMotmPhoto} hidden />
                      {motm.name
                        ? <>
                            <div className="spotlight-name">{motm.name}</div>
                            <div className="spotlight-role">{motm.role}</div>
                          </>
                        : <input
                            className="inline-input"
                            style={{textAlign:'center',marginTop:4}}
                            placeholder="Enter name..."
                            value={motm.name}
                            onChange={e=>setMotm(p=>({...p,name:e.target.value}))}
                          />
                      }
                    </div>
                    <div className="spotlight-card">
                      <div className="spotlight-label">APS Mascot</div>
                      <label style={{cursor:'pointer'}} onClick={()=>mascotRef.current?.click()}>
                        {mascot
                          ? <img src={mascot} alt="Mascot" className="spotlight-avatar" />
                          : <div className="spotlight-avatar-placeholder">🐾</div>
                        }
                      </label>
                      <input ref={mascotRef} type="file" accept="image/*" onChange={handleMascotUpload} hidden />
                      {!mascot && <span className="spotlight-empty">Click to upload mascot</span>}
                    </div>
                  </div>
                </div>
              </div>

              <div className="stats-row">
                <div className="stat-card"><div className="stat-value">{activeTeams.callCenter.length + activeTeams.sales.length + activeTeams.collections.length + activeTeams.districts.length}</div><div className="stat-label">Total Team Members</div></div>
                <div className="stat-card good"><div className="stat-value">{generated ? Object.values(coverage).filter(c=>c.meetsTarget).length : '–'}</div><div className="stat-label">Days Meeting Target</div></div>
                <div className="stat-card warn"><div className="stat-value">{generated ? Object.values(coverage).filter(c=>!c.meetsTarget).length : '–'}</div><div className="stat-label">Coverage Gaps</div></div>
                <div className="stat-card peak"><div className="stat-value">{Object.keys(PEAK_DAYS).length}</div><div className="stat-label">Peak Days</div></div>
                <div className="stat-card high"><div className="stat-value">{Object.keys(HIGH_DEMAND_DAYS).length}</div><div className="stat-label">High Demand Days</div></div>
              </div>
            </div>
          )}

          {/* CC – SCHEDULE GRID */}
          {page === 'cc-schedule' && (
            <div>
              {!generated ? (
                <div className="empty-state">
                  <div className="empty-icon">📅</div>
                  <h2>No Schedule Generated Yet</h2>
                  <p>Add your managers in Settings, upload forecast data, then click Generate Schedule.</p>
                  <button className="btn btn-primary btn-lg" onClick={handleGenerate}>⚡ Generate Schedule</button>
                </div>
              ) : (
                <>
                  <div className="schedule-meta">
                    <span className="meta-item"><strong>{dates.length}</strong> days</span>
                    <span className="meta-item"><strong>{activeTeams.callCenter.length}</strong> managers</span>
                    <span className="meta-item"><span className="dot dot-red"/>  {Object.values(coverage).filter(c=>c.isPeak).length} peak days</span>
                    <span className="meta-item"><span className="dot dot-gold"/> {Object.values(coverage).filter(c=>c.isHighDemand).length} high-demand</span>
                    <span className="meta-item gap-count">⚠ {Object.values(coverage).filter(c=>!c.meetsTarget).length} gaps</span>
                  </div>
                  <div className="grid-scroll">
                    <table className="schedule-table">
                      <thead>
                        <tr>
                          <th className="col-date sticky-col">Date</th>
                          <th className="col-dow sticky-col2">DOW</th>
                          {activeTeams.callCenter.map(m=>(
                            <th key={m.id} className="col-manager" title={`${m.name} · ${m.sites}`}>
                              {m.name.split(' ').pop()}
                            </th>
                          ))}
                          <th className="col-summary">A</th>
                          <th className="col-summary">B</th>
                          <th className="col-summary">C</th>
                          <th className="col-summary col-total">Tot</th>
                          <th className="col-forecast">Calls</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dates.map(date => {
                          const dk = getDateKey(date);
                          const ds = schedule[dk]||{};
                          const cov = coverage[dk]||{};
                          const dow = getDay(date);
                          const isWknd = dow===0||dow===6;
                          return (
                            <tr key={dk} className={`${cov.isPeak?'row-peak':''} ${cov.isHighDemand&&!cov.isPeak?'row-high':''} ${isWknd?'row-weekend':''} ${!cov.meetsTarget?'row-gap':''}`}>
                              <td className="col-date sticky-col">
                                <div className="date-cell">
                                  <span className="date-label">{format(date,'MMM d')}</span>
                                  {cov.isPeak && <span className="day-badge peak">PEAK</span>}
                                  {cov.isHighDemand&&!cov.isPeak && <span className="day-badge high">HIGH</span>}
                                </div>
                              </td>
                              <td className={`col-dow sticky-col2 dow-${DOW_LABELS[dow].toLowerCase()}`}>{DOW_LABELS[dow]}</td>
                              {activeTeams.callCenter.map(m => {
                                const shift = ds[m.id]||'OFF';
                                const isEditing = editCell?.dk===dk && editCell?.mid===m.id;
                                return (
                                  <td key={m.id} className={`shift-cell shift-cell-${shift.toLowerCase()}`} onClick={()=>setEditCell({dk,mid:m.id})}>
                                    {isEditing
                                      ? <select autoFocus defaultValue={shift} onChange={e=>handleCellChange(dk,m.id,e.target.value)} onBlur={()=>setEditCell(null)} className="shift-select">
                                          {['A','B','C','OFF'].map(s=><option key={s} value={s}>{s}</option>)}
                                        </select>
                                      : <ShiftBadge shift={shift}/>
                                    }
                                  </td>
                                );
                              })}
                              <td className={`col-summary ${cov.gaps?.A<0?'summary-gap':''}`}>{cov.counts?.A??0}</td>
                              <td className={`col-summary ${cov.gaps?.B<0?'summary-gap':''}`}>{cov.counts?.B??0}</td>
                              <td className={`col-summary ${cov.gaps?.C<0?'summary-gap':''}`}>{cov.counts?.C??0}</td>
                              <td className="col-summary col-total">{cov.totalWorking??0}</td>
                              <td className="col-forecast">
                                {cov.forecastCalls
                                  ? <span className={`forecast-pill ${cov.isPeak?'fc-peak':cov.isHighDemand?'fc-high':''}`}>{cov.forecastCalls.toLocaleString()}</span>
                                  : '–'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="grid-hint">Click any shift cell to manually override.</p>
                </>
              )}
            </div>
          )}

          {/* CC – COVERAGE ANALYSIS */}
          {page === 'cc-coverage' && (
            <div>
              <h2 className="section-title">Coverage Analysis</h2>
              {!generated ? <p className="text-muted">Generate a schedule first.</p> : (
                <>
                  <div className="stats-row">
                    <div className="stat-card good"><div className="stat-value">{Object.values(coverage).filter(c=>c.meetsTarget).length}</div><div className="stat-label">Days Meeting Target</div></div>
                    <div className="stat-card warn"><div className="stat-value">{Object.values(coverage).filter(c=>!c.meetsTarget).length}</div><div className="stat-label">Days with Gaps</div></div>
                    <div className="stat-card peak"><div className="stat-value">{Object.values(coverage).filter(c=>c.isPeak).length}</div><div className="stat-label">Peak Days</div></div>
                    <div className="stat-card high"><div className="stat-value">{Object.values(coverage).filter(c=>c.isHighDemand).length}</div><div className="stat-label">High Demand Days</div></div>
                  </div>
                  <h3 className="subsection-title">Coverage Gaps</h3>
                  {Object.entries(coverage).filter(([,c])=>!c.meetsTarget).length===0
                    ? <div className="all-clear">✅ All days meet coverage targets</div>
                    : (
                      <table className="data-table">
                        <thead><tr><th>Date</th><th>DOW</th><th>Forecast</th><th>Shift A</th><th>Shift B</th><th>Shift C</th><th>Flag</th></tr></thead>
                        <tbody>
                          {Object.entries(coverage).filter(([,c])=>!c.meetsTarget).map(([dk,c])=>{
                            const date=parseISO(dk);
                            return (
                              <tr key={dk} className={c.isPeak?'row-peak':c.isHighDemand?'row-high':'row-gap'}>
                                <td>{format(date,'EEE MMM d')}</td>
                                <td>{DOW_LABELS[getDay(date)]}</td>
                                <td>{c.forecastCalls?.toLocaleString()||'–'}</td>
                                <td className={c.gaps.A<0?'text-red':''}>{c.counts.A}/{c.target.A}{c.gaps.A<0&&` (${c.gaps.A})`}</td>
                                <td className={c.gaps.B<0?'text-red':''}>{c.counts.B}/{c.target.B}{c.gaps.B<0&&` (${c.gaps.B})`}</td>
                                <td className={c.gaps.C<0?'text-red':''}>{c.counts.C}/{c.target.C}{c.gaps.C<0&&` (${c.gaps.C})`}</td>
                                <td><span className={`flag-badge ${c.isPeak?'flag-peak':c.isHighDemand?'flag-high':'flag-gap'}`}>{c.isPeak?'🔴 PEAK':c.isHighDemand?'🟠 HIGH':'🟡 GAP'}</span></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )
                  }
                  <h3 className="subsection-title">Peak & High-Demand Days</h3>
                  <table className="data-table">
                    <thead><tr><th>Date</th><th>Type</th><th>Forecast Calls</th><th>Target</th><th>Actual</th><th>Status</th></tr></thead>
                    <tbody>
                      {Object.entries(coverage).filter(([,c])=>c.isPeak||c.isHighDemand).map(([dk,c])=>{
                        const date=parseISO(dk);
                        return (
                          <tr key={dk} className={c.isPeak?'row-peak':'row-high'}>
                            <td>{format(date,'EEE, MMM d yyyy')}</td>
                            <td>{c.isPeak?'Peak':'High Demand'}</td>
                            <td>{c.forecastCalls?.toLocaleString()}</td>
                            <td>{c.target.A}A / {c.target.B}B / {c.target.C}C</td>
                            <td>{c.counts.A}A / {c.counts.B}B / {c.counts.C}C</td>
                            <td><span className={`status-badge ${c.meetsTarget?'status-ok':'status-gap'}`}>{c.meetsTarget?'✓ Met':'✗ Gap'}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}

          {/* CC – MANAGER SUMMARY */}
          {page === 'cc-summary' && (
            <div>
              <h2 className="section-title">Manager Summary</h2>
              <div className="member-cards-grid" style={{marginBottom:24}}>
                {activeTeams.callCenter.map(m=>(
                  <div className="member-card" key={m.id}>
                    <MemberAvatar name={m.name} />
                    <div className="member-info">
                      <div className="member-name">{m.name}</div>
                      <div className="member-role">{m.role}</div>
                      <div className="member-sites">{m.sites||'No sites assigned'}</div>
                    </div>
                  </div>
                ))}
              </div>
              {!generated ? <p className="text-muted">Generate a schedule to see shift breakdowns.</p> : (
                <table className="data-table">
                  <thead><tr><th>Manager</th><th>Role</th><th>Sites</th><th>Shift A</th><th>Shift B</th><th>Shift C</th><th>Total Working</th><th>Days Off</th><th>Anchor</th></tr></thead>
                  <tbody>
                    {managerSummary.map(s=>{
                      const mgr=activeTeams.callCenter.find(m=>m.id===s.id);
                      return (
                        <tr key={s.id}>
                          <td className="font-bold">{s.name}</td>
                          <td className="text-muted">{mgr?.role}</td>
                          <td className="text-muted" style={{fontSize:11}}>{mgr?.sites||'–'}</td>
                          <td><span className="shift-count shift-count-a">{s.A}</span></td>
                          <td><span className="shift-count shift-count-b">{s.B}</span></td>
                          <td><span className="shift-count shift-count-c">{s.C}</span></td>
                          <td className="font-bold">{s.total}</td>
                          <td className="text-muted">{s.OFF}</td>
                          <td>{mgr?.shiftAnchor || mgr?.shift_anchor ? <ShiftBadge shift={mgr.shiftAnchor || mgr.shift_anchor}/> : <span className="text-muted">Flex</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* CC – FORECAST & DATA */}
          {page === 'cc-forecast' && (
            <div>
              <h2 className="section-title">Forecast & Data</h2>
              <div className="upload-grid">
                <div className="upload-card">
                  <h3>Call Volume Forecast</h3>
                  <p className="upload-desc">Upload your YTD Total Calls Excel file to show daily forecast alongside the schedule.</p>
                  <label className="upload-btn"><span>📂 Upload Forecast File</span><input type="file" accept=".xlsx,.xls,.csv" onChange={handleForecastUpload} ref={forecastRef} hidden/></label>
                  {Object.keys(forecastData).length>0 && <div className="upload-status success">✓ {Object.keys(forecastData).length} days loaded</div>}
                </div>
                <div className="upload-card">
                  <h3>Hourly Distribution</h3>
                  <p className="upload-desc">Upload your YTD Total Calls by Time file for intraday staffing reference.</p>
                  <label className="upload-btn"><span>📂 Upload Hourly File</span><input type="file" accept=".xlsx,.xls,.csv" onChange={handleHourlyUpload} ref={hourlyRef} hidden/></label>
                  {hourlyData.length>0 && <div className="upload-status success">✓ {hourlyData.length} hourly rows loaded</div>}
                </div>
              </div>
              {hourlyData.length>0 && (
                <div>
                  <h3 className="subsection-title">Hourly Call Distribution</h3>
                  <div className="hourly-chart">
                    {hourlyData.filter(h=>h.callsPerDay>0).map((h,i)=>{
                      const max=Math.max(...hourlyData.map(x=>x.callsPerDay));
                      const pct=(h.callsPerDay/max)*100;
                      const hour=typeof h.hour==='string'?h.hour.slice(0,5):h.hour;
                      const inB=i>=12&&i<20, inC=i>=14&&i<22;
                      return (
                        <div key={i} className="bar-col">
                          <div className="bar-label-top">{h.callsPerDay.toFixed(1)}</div>
                          <div className={`bar ${inC?'bar-c':inB?'bar-b':i>=8?'bar-a':'bar-pre'}`} style={{height:`${Math.max(pct,2)}%`}}/>
                          <div className="bar-label">{hour}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="chart-legend">
                    <span className="legend-item"><span className="legend-dot dot-a"/>Shift A</span>
                    <span className="legend-item"><span className="legend-dot dot-b"/>Shift A+B</span>
                    <span className="legend-item"><span className="legend-dot dot-c"/>Shift B+C</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SALES / COLLECTIONS / DISTRICT LEADERS */}
          {['sales','collections','districts'].map(teamKey => {
            const roleMap  = { sales:'Sales Rep', collections:'Collections', districts:'District Leader' };
            const pageMap  = { sales:'sales', collections:'collections', districts:'districts' };
            if (page !== pageMap[teamKey]) return null;

            const members  = activeTeams[teamKey];
            const meta     = TEAM_META[teamKey];
            const manSch   = manualSchedules[teamKey];

            return (
              <div key={teamKey}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
                  <h2 className="section-title" style={{margin:0}}>{meta.icon} {meta.label}</h2>
                  <button className="btn btn-secondary btn-sm" onClick={()=>addMember(teamKey, roleMap[teamKey])}>+ Add Member</button>
                </div>
                <div className="member-cards-grid">
                  {members.map(m=>(
                    <div className="member-card" key={m.id}>
                      <MemberAvatar name={m.name} />
                      <div className="member-info">
                        <div className="member-name">{m.name}</div>
                        <div className="member-role">{m.role}</div>
                        <div className="member-sites">{m.sites||'No sites assigned'}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <h3 className="subsection-title">Schedule – {format(parseISO(startDate),'MMM d')} to {format(parseISO(endDate),'MMM d, yyyy')}</h3>
                <div className="manual-grid-scroll">
                  <table className="manual-table">
                    <thead>
                      <tr>
                        <th style={{minWidth:90}}>Date</th>
                        <th style={{minWidth:44}}>DOW</th>
                        {members.map(m=><th key={m.id} style={{minWidth:100}}>{m.name.split(' ').slice(0,2).join(' ')}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {dates.map(date=>{
                        const dk=getDateKey(date);
                        const dow=getDay(date);
                        const isWknd=dow===0||dow===6;
                        return (
                          <tr key={dk} className={isWknd?'row-weekend':''}>
                            <td style={{fontWeight:500}}>{format(date,'MMM d')}</td>
                            <td className={`dow-${DOW_LABELS[dow].toLowerCase()}`}>{DOW_LABELS[dow]}</td>
                            {members.map(m=>{
                              const val = manSch[dk]?.[m.id] || '';
                              return (
                                <td key={m.id}>
                                  <select
                                    className="inline-select"
                                    value={val}
                                    onChange={e=>setManualCell(teamKey,dk,m.id,e.target.value)}
                                    style={{width:'100%'}}
                                  >
                                    <option value="">–</option>
                                    {teamKey==='districts'
                                      ? ['ON','OFF','Travel','Meeting'].map(o=><option key={o} value={o}>{o}</option>)
                                      : ['A','B','C','OFF'].map(o=><option key={o} value={o}>{o}</option>)
                                    }
                                  </select>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="grid-hint">Select schedule entries for each team member per day.</p>
              </div>
            );
          })}

          {/* SETTINGS */}
          {page === 'settings' && (
            <div>
              <h2 className="section-title">Settings</h2>
              <div className="settings-section">
                <h3>Team Spotlights</h3>
                <div className="form-row" style={{gap:24,flexWrap:'wrap'}}>
                  <div className="form-group">
                    <label>Team Member of the Month – Name</label>
                    <input className="form-input" value={motm.name} onChange={e=>setMotm(p=>({...p,name:e.target.value}))} placeholder="Full name" />
                  </div>
                  <div className="form-group">
                    <label>Role / Achievement</label>
                    <input className="form-input" value={motm.role} onChange={e=>setMotm(p=>({...p,role:e.target.value}))} placeholder="e.g. Site Manager · Q2 Top Performer" />
                  </div>
                  <div className="form-group">
                    <label>Photo</label>
                    <label className="upload-btn"><span>📷 Upload Photo</span><input type="file" accept="image/*" onChange={handleMotmPhoto} hidden/></label>
                  </div>
                </div>
              </div>

              {Object.entries({
                callCenter:  { label: 'Call Center – Site Managers', role: 'Site Manager' },
                sales:       { label: 'Sales Team',                  role: 'Sales Rep' },
                collections: { label: 'Collections Team',            role: 'Collections' },
                districts:   { label: 'District Leaders',            role: 'District Leader' },
              }).map(([tk, meta]) => (
                <div className="settings-section" key={tk}>
                  <div className="section-header-row">
                    <h3>{meta.label} ({activeTeams[tk].length})</h3>
                    <button className="btn btn-sm btn-secondary" onClick={()=>addMember(tk,meta.role)}>+ Add</button>
                  </div>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Sites Managed</th>
                        {tk==='callCenter' && <><th>Shift Anchor</th><th>Rotation Offset</th></>}
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeTeams[tk].map(m=>(
                        <tr key={m.id}>
                          <td><input className="inline-input" value={getMemberValue(m,'name')} onChange={e=>updateMember(tk,m.id,'name',e.target.value)}/></td>
                          <td><input className="inline-input" value={getMemberValue(m,'role')} onChange={e=>updateMember(tk,m.id,'role',e.target.value)}/></td>
                          <td><input className="inline-input" style={{minWidth:200}} value={getMemberValue(m,'sites')} onChange={e=>updateMember(tk,m.id,'sites',e.target.value)} placeholder="Location 1, Location 2..."/></td>
                          {tk==='callCenter' && (
                            <>
                              <td>
                                <select className="inline-select" value={getMemberValue(m,'shiftAnchor')} onChange={e=>updateMember(tk,m.id,'shiftAnchor',e.target.value||null)}>
                                  <option value="">Flexible</option>
                                  {['A','B','C'].map(s=><option key={s} value={s}>Shift {s}</option>)}
                                </select>
                              </td>
                              <td>
                                <select className="inline-select" value={getMemberValue(m,'rotationOffset')} onChange={e=>updateMember(tk,m.id,'rotationOffset',e.target.value!==''?Number(e.target.value):undefined)}>
                                  <option value="">Auto</option>
                                  {[0,1,2,3,4,5,6].map(n=><option key={n} value={n}>Day {n}</option>)}
                                </select>
                              </td>
                            </>
                          )}
                          <td><button className="btn-icon" onClick={()=>removeMember(tk,m.id)}>✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}