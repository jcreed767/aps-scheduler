import React, { useState, useCallback, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { format, parseISO, getDay } from 'date-fns';
import {
  generateRotation,
  analyzeCoverage,
  getManagerSummary,
  getAllDates,
  getDateKey,
  DOW_LABELS,
  parseForecastFile,
  parseHourlyFile,
  DEFAULT_TARGETS,
} from './utils/schedulingEngine';

// ─── Default Config ────────────────────────────────────────────────────────────

const DEFAULT_START = '2026-06-05';
const DEFAULT_END = '2026-07-31';

const PLACEHOLDER_MANAGERS = Array.from({ length: 14 }, (_, i) => ({
  id: `mgr-${i + 1}`,
  name: `Manager ${i + 1}`,
  shiftAnchor: null,
  unavailable: [],
  rotationOffset: undefined,
}));

// ─── Small Components ─────────────────────────────────────────────────────────

function ShiftBadge({ shift, size = 'sm' }) {
  if (!shift || shift === 'OFF') {
    return (
      <span className={`shift-badge shift-off ${size}`}>OFF</span>
    );
  }
  return (
    <span className={`shift-badge shift-${shift.toLowerCase()} ${size}`}>
      {shift}
    </span>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'schedule', label: 'Schedule Grid' },
  { id: 'coverage', label: 'Coverage Analysis' },
  { id: 'managers', label: 'Manager Summary' },
  { id: 'forecast', label: 'Forecast & Data' },
  { id: 'settings', label: 'Settings' },
];

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab] = useState('schedule');
  const [managers, setManagers] = useState(PLACEHOLDER_MANAGERS);
  const [startDate, setStartDate] = useState(DEFAULT_START);
  const [endDate, setEndDate] = useState(DEFAULT_END);
  const [forecastData, setForecastData] = useState({});
  const [hourlyData, setHourlyData] = useState([]);
  const [manualOverrides, setManualOverrides] = useState({});
  const [schedule, setSchedule] = useState(null);
  const [isGenerated, setIsGenerated] = useState(false);
  const [editingCell, setEditingCell] = useState(null);
  const forecastRef = useRef(null);
  const hourlyRef = useRef(null);

  // ── Generate Schedule ──
  const handleGenerate = useCallback(() => {
    const s = generateRotation(managers, startDate, endDate, manualOverrides);
    setSchedule(s);
    setIsGenerated(true);
  }, [managers, startDate, endDate, manualOverrides]);

  // ── Coverage Analysis ──
  const coverage = useMemo(() => {
    if (!schedule) return {};
    return analyzeCoverage(schedule, managers, forecastData);
  }, [schedule, managers, forecastData]);

  // ── Manager Summary ──
  const managerSummary = useMemo(() => {
    if (!schedule) return [];
    return getManagerSummary(schedule, managers);
  }, [schedule, managers]);

  // ── Dates ──
  const dates = useMemo(() => getAllDates(startDate, endDate), [startDate, endDate]);

  // ── Cell Edit ──
  const handleCellClick = (dateKey, managerId) => {
    setEditingCell({ dateKey, managerId });
  };

  const handleCellChange = (dateKey, managerId, newShift) => {
    const updated = {
      ...manualOverrides,
      [dateKey]: { ...(manualOverrides[dateKey] || {}), [managerId]: newShift },
    };
    setManualOverrides(updated);
    if (schedule) {
      setSchedule(prev => ({
        ...prev,
        [dateKey]: { ...prev[dateKey], [managerId]: newShift },
      }));
    }
    setEditingCell(null);
  };

  // ── File Upload ──
  const handleForecastUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws);
      setForecastData(parseForecastFile(data));
    };
    reader.readAsBinaryString(file);
  };

  const handleHourlyUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws);
      setHourlyData(parseHourlyFile(data));
    };
    reader.readAsBinaryString(file);
  };

  // ── Export ──
  const handleExport = () => {
    if (!schedule) return;
    const wb = XLSX.utils.book_new();

    // Sheet 1: Schedule Grid
    const gridRows = [['Date', 'Day', 'DOW', ...managers.map(m => m.name), 'Total A', 'Total B', 'Total C', 'Total Working', 'Meets Target', 'Forecast Calls']];
    dates.forEach(date => {
      const dk = getDateKey(date);
      const daySchedule = schedule[dk] || {};
      const cov = coverage[dk] || {};
      const row = [
        dk,
        format(date, 'MMM d'),
        DOW_LABELS[getDay(date)],
        ...managers.map(m => daySchedule[m.id] || 'OFF'),
        cov.counts?.A || 0,
        cov.counts?.B || 0,
        cov.counts?.C || 0,
        cov.totalWorking || 0,
        cov.meetsTarget ? 'Yes' : 'No',
        cov.forecastCalls || '',
      ];
      gridRows.push(row);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(gridRows), 'Schedule');

    // Sheet 2: Manager Summary
    const summaryRows = [['Manager', 'Shift A', 'Shift B', 'Shift C', 'Total Working Days', 'Days Off']];
    managerSummary.forEach(s => {
      summaryRows.push([s.name, s.A, s.B, s.C, s.total, s.OFF]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Manager Summary');

    // Sheet 3: Coverage Flags
    const flagRows = [['Date', 'Day', 'Forecast Calls', 'Shift A (actual/target)', 'Shift B (actual/target)', 'Shift C (actual/target)', 'Meets Target', 'Flag']];
    dates.forEach(date => {
      const dk = getDateKey(date);
      const cov = coverage[dk] || {};
      if (!cov.meetsTarget) {
        flagRows.push([
          dk,
          format(date, 'EEE MMM d'),
          cov.forecastCalls || '',
          `${cov.counts?.A || 0}/${cov.target?.A || 0}`,
          `${cov.counts?.B || 0}/${cov.target?.B || 0}`,
          `${cov.counts?.C || 0}/${cov.target?.C || 0}`,
          'No',
          cov.isPeak ? '🔴 PEAK' : cov.isHighDemand ? '🟠 HIGH' : '🟡 GAP',
        ]);
      }
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(flagRows), 'Coverage Gaps');

    XLSX.writeFile(wb, `call-center-schedule-${startDate}-to-${endDate}.xlsx`);
  };

  // ── Manager Editor ──
  const updateManager = (id, field, value) => {
    setManagers(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  const addManager = () => {
    const newId = `mgr-${Date.now()}`;
    setManagers(prev => [...prev, { id: newId, name: 'New Manager', shiftAnchor: null, unavailable: [], rotationOffset: undefined }]);
  };

  const removeManager = (id) => {
    setManagers(prev => prev.filter(m => m.id !== id));
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="header-inner">
          <div className="header-title">
            <div className="header-icon">📞</div>
            <div>
              <h1>Call Center Scheduler</h1>
              <p className="header-sub">Inbound staffing · {managers.length} Site Managers · 5/2 rotation</p>
            </div>
          </div>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={handleGenerate}>
              ⚡ Generate Schedule
            </button>
            {isGenerated && (
              <button className="btn btn-secondary" onClick={handleExport}>
                ↓ Export to Excel
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="main-content">

        {/* ── Schedule Grid Tab ── */}
        {activeTab === 'schedule' && (
          <div className="tab-content">
            {!isGenerated ? (
              <div className="empty-state">
                <div className="empty-icon">📅</div>
                <h2>No Schedule Generated Yet</h2>
                <p>Configure your managers in Settings, upload forecast data in Forecast & Data, then click Generate Schedule.</p>
                <button className="btn btn-primary lg" onClick={handleGenerate}>
                  ⚡ Generate Schedule
                </button>
              </div>
            ) : (
              <div className="schedule-wrapper">
                <div className="schedule-meta">
                  <span className="meta-item">
                    <strong>{dates.length}</strong> days
                  </span>
                  <span className="meta-item">
                    <strong>{managers.length}</strong> managers
                  </span>
                  <span className="meta-item">
                    <span className="dot dot-red" /> {Object.values(coverage).filter(c => c.isPeak).length} peak days
                  </span>
                  <span className="meta-item">
                    <span className="dot dot-orange" /> {Object.values(coverage).filter(c => c.isHighDemand).length} high-demand days
                  </span>
                  <span className="meta-item gap-count">
                    ⚠ {Object.values(coverage).filter(c => !c.meetsTarget).length} coverage gaps
                  </span>
                </div>

                <div className="grid-scroll">
                  <table className="schedule-table">
                    <thead>
                      <tr>
                        <th className="col-date sticky-col">Date</th>
                        <th className="col-dow sticky-col2">DOW</th>
                        {managers.map(m => (
                          <th key={m.id} className="col-manager" title={m.name}>
                            {m.name.split(' ').pop()}
                          </th>
                        ))}
                        <th className="col-summary">A</th>
                        <th className="col-summary">B</th>
                        <th className="col-summary">C</th>
                        <th className="col-summary">Tot</th>
                        <th className="col-forecast">Calls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dates.map(date => {
                        const dk = getDateKey(date);
                        const daySchedule = schedule[dk] || {};
                        const cov = coverage[dk] || {};
                        const dow = getDay(date);
                        const isWeekend = dow === 0 || dow === 6;
                        const isPeak = cov.isPeak;
                        const isHigh = cov.isHighDemand;
                        const hasGap = !cov.meetsTarget;

                        return (
                          <tr
                            key={dk}
                            className={`
                              ${isPeak ? 'row-peak' : ''}
                              ${isHigh && !isPeak ? 'row-high' : ''}
                              ${isWeekend ? 'row-weekend' : ''}
                              ${hasGap ? 'row-gap' : ''}
                            `}
                          >
                            <td className="col-date sticky-col">
                              <div className="date-cell">
                                <span className="date-label">{format(date, 'MMM d')}</span>
                                {isPeak && <span className="day-badge peak">PEAK</span>}
                                {isHigh && !isPeak && <span className="day-badge high">HIGH</span>}
                              </div>
                            </td>
                            <td className={`col-dow sticky-col2 dow-${DOW_LABELS[dow].toLowerCase()}`}>
                              {DOW_LABELS[dow]}
                            </td>
                            {managers.map(m => {
                              const shift = daySchedule[m.id] || 'OFF';
                              const isEditing = editingCell?.dateKey === dk && editingCell?.managerId === m.id;
                              return (
                                <td
                                  key={m.id}
                                  className={`shift-cell shift-cell-${shift.toLowerCase()}`}
                                  onClick={() => handleCellClick(dk, m.id)}
                                >
                                  {isEditing ? (
                                    <select
                                      autoFocus
                                      defaultValue={shift}
                                      onChange={e => handleCellChange(dk, m.id, e.target.value)}
                                      onBlur={() => setEditingCell(null)}
                                      className="shift-select"
                                    >
                                      <option value="A">A</option>
                                      <option value="B">B</option>
                                      <option value="C">C</option>
                                      <option value="OFF">OFF</option>
                                    </select>
                                  ) : (
                                    <ShiftBadge shift={shift} />
                                  )}
                                </td>
                              );
                            })}
                            <td className={`col-summary ${cov.gaps?.A < 0 ? 'summary-gap' : ''}`}>
                              {cov.counts?.A ?? 0}
                            </td>
                            <td className={`col-summary ${cov.gaps?.B < 0 ? 'summary-gap' : ''}`}>
                              {cov.counts?.B ?? 0}
                            </td>
                            <td className={`col-summary ${cov.gaps?.C < 0 ? 'summary-gap' : ''}`}>
                              {cov.counts?.C ?? 0}
                            </td>
                            <td className="col-summary col-total">
                              {cov.totalWorking ?? 0}
                            </td>
                            <td className="col-forecast">
                              {cov.forecastCalls ? (
                                <span className={`forecast-pill ${isPeak ? 'fc-peak' : isHigh ? 'fc-high' : ''}`}>
                                  {cov.forecastCalls.toLocaleString()}
                                </span>
                              ) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="grid-hint">Click any shift cell to edit it manually.</p>
              </div>
            )}
          </div>
        )}

        {/* ── Coverage Analysis Tab ── */}
        {activeTab === 'coverage' && (
          <div className="tab-content">
            <h2 className="section-title">Coverage Analysis</h2>
            {!isGenerated ? (
              <p className="muted">Generate a schedule first to see coverage analysis.</p>
            ) : (
              <>
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-value">{Object.values(coverage).filter(c => c.meetsTarget).length}</div>
                    <div className="stat-label">Days Meeting Target</div>
                  </div>
                  <div className="stat-card stat-warn">
                    <div className="stat-value">{Object.values(coverage).filter(c => !c.meetsTarget).length}</div>
                    <div className="stat-label">Days with Gaps</div>
                  </div>
                  <div className="stat-card stat-peak">
                    <div className="stat-value">{Object.values(coverage).filter(c => c.isPeak).length}</div>
                    <div className="stat-label">Peak Days</div>
                  </div>
                  <div className="stat-card stat-high">
                    <div className="stat-value">{Object.values(coverage).filter(c => c.isHighDemand).length}</div>
                    <div className="stat-label">High Demand Days</div>
                  </div>
                </div>

                <h3 className="subsection-title">Coverage Gaps — Days Needing Attention</h3>
                {Object.entries(coverage).filter(([, c]) => !c.meetsTarget).length === 0 ? (
                  <div className="all-clear">✅ All days meet coverage targets</div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>DOW</th>
                        <th>Forecast Calls</th>
                        <th>Shift A (actual/target)</th>
                        <th>Shift B (actual/target)</th>
                        <th>Shift C (actual/target)</th>
                        <th>Flag</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(coverage)
                        .filter(([, c]) => !c.meetsTarget)
                        .map(([dk, c]) => {
                          const date = parseISO(dk);
                          return (
                            <tr key={dk} className={c.isPeak ? 'row-peak' : c.isHighDemand ? 'row-high' : 'row-gap'}>
                              <td>{format(date, 'EEE MMM d')}</td>
                              <td>{DOW_LABELS[getDay(date)]}</td>
                              <td>{c.forecastCalls?.toLocaleString() || '—'}</td>
                              <td className={c.gaps.A < 0 ? 'text-red' : ''}>
                                {c.counts.A}/{c.target.A} {c.gaps.A < 0 && `(${c.gaps.A})`}
                              </td>
                              <td className={c.gaps.B < 0 ? 'text-red' : ''}>
                                {c.counts.B}/{c.target.B} {c.gaps.B < 0 && `(${c.gaps.B})`}
                              </td>
                              <td className={c.gaps.C < 0 ? 'text-red' : ''}>
                                {c.counts.C}/{c.target.C} {c.gaps.C < 0 && `(${c.gaps.C})`}
                              </td>
                              <td>
                                <span className={`flag-badge ${c.isPeak ? 'flag-peak' : c.isHighDemand ? 'flag-high' : 'flag-gap'}`}>
                                  {c.isPeak ? '🔴 PEAK' : c.isHighDemand ? '🟠 HIGH' : '🟡 GAP'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                )}

                <h3 className="subsection-title">Peak Day Detail</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Forecast Calls</th>
                      <th>Target Split</th>
                      <th>Actual Split</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(coverage)
                      .filter(([, c]) => c.isPeak || c.isHighDemand)
                      .map(([dk, c]) => {
                        const date = parseISO(dk);
                        return (
                          <tr key={dk} className={c.isPeak ? 'row-peak' : 'row-high'}>
                            <td>{format(date, 'EEE, MMM d yyyy')}</td>
                            <td>{c.isPeak ? 'Peak' : 'High Demand'}</td>
                            <td>{c.forecastCalls?.toLocaleString()}</td>
                            <td>{c.target.A}A / {c.target.B}B / {c.target.C}C</td>
                            <td>{c.counts.A}A / {c.counts.B}B / {c.counts.C}C</td>
                            <td>
                              <span className={`status-badge ${c.meetsTarget ? 'status-ok' : 'status-gap'}`}>
                                {c.meetsTarget ? '✓ Met' : '✗ Gap'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        {/* ── Manager Summary Tab ── */}
        {activeTab === 'managers' && (
          <div className="tab-content">
            <h2 className="section-title">Manager Summary</h2>
            {!isGenerated ? (
              <p className="muted">Generate a schedule first to see manager summaries.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Manager</th>
                    <th>Shift A Days</th>
                    <th>Shift B Days</th>
                    <th>Shift C Days</th>
                    <th>Total Working</th>
                    <th>Days Off</th>
                    <th>Shift Anchor</th>
                  </tr>
                </thead>
                <tbody>
                  {managerSummary.map(s => {
                    const mgr = managers.find(m => m.id === s.id);
                    return (
                      <tr key={s.id}>
                        <td className="manager-name-cell">{s.name}</td>
                        <td>
                          <span className="shift-count shift-count-a">{s.A}</span>
                        </td>
                        <td>
                          <span className="shift-count shift-count-b">{s.B}</span>
                        </td>
                        <td>
                          <span className="shift-count shift-count-c">{s.C}</span>
                        </td>
                        <td className="font-bold">{s.total}</td>
                        <td className="text-muted">{s.OFF}</td>
                        <td>
                          {mgr?.shiftAnchor ? (
                            <ShiftBadge shift={mgr.shiftAnchor} />
                          ) : (
                            <span className="text-muted">Flexible</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Forecast & Data Tab ── */}
        {activeTab === 'forecast' && (
          <div className="tab-content">
            <h2 className="section-title">Forecast & Data</h2>

            <div className="upload-grid">
              <div className="upload-card">
                <h3>Call Volume Forecast</h3>
                <p className="upload-desc">Upload your YTD Total Calls Excel file. Used to show daily forecast alongside the schedule.</p>
                <label className="upload-btn">
                  📂 Upload Forecast File
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={handleForecastUpload} ref={forecastRef} hidden />
                </label>
                {Object.keys(forecastData).length > 0 && (
                  <div className="upload-status success">
                    ✓ {Object.keys(forecastData).length} days of forecast data loaded
                  </div>
                )}
              </div>

              <div className="upload-card">
                <h3>Hourly Distribution</h3>
                <p className="upload-desc">Upload your YTD Total Calls by Time Excel file. Used for intraday staffing reference.</p>
                <label className="upload-btn">
                  📂 Upload Hourly File
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={handleHourlyUpload} ref={hourlyRef} hidden />
                </label>
                {hourlyData.length > 0 && (
                  <div className="upload-status success">
                    ✓ {hourlyData.length} hourly distribution rows loaded
                  </div>
                )}
              </div>
            </div>

            {hourlyData.length > 0 && (
              <div className="hourly-section">
                <h3 className="subsection-title">Hourly Call Distribution</h3>
                <div className="hourly-chart">
                  {hourlyData.filter(h => h.callsPerDay > 0).map((h, i) => {
                    const max = Math.max(...hourlyData.map(x => x.callsPerDay));
                    const pct = (h.callsPerDay / max) * 100;
                    const hour = typeof h.hour === 'string' ? h.hour.slice(0, 5) : h.hour;
                    const inShiftA = i >= 8 && i < 16;
                    const inShiftB = i >= 12 && i < 20;
                    const inShiftC = i >= 14 && i < 22;
                    return (
                      <div key={i} className="bar-col">
                        <div className="bar-label-top">{h.callsPerDay.toFixed(1)}</div>
                        <div
                          className={`bar ${inShiftA && !inShiftB ? 'bar-a' : inShiftB && !inShiftC ? 'bar-b' : inShiftC ? 'bar-c' : 'bar-pre'}`}
                          style={{ height: `${Math.max(pct, 2)}%` }}
                        />
                        <div className="bar-label">{hour}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="chart-legend">
                  <span className="legend-item"><span className="legend-dot dot-a" />Shift A only</span>
                  <span className="legend-item"><span className="legend-dot dot-b" />Shift A+B overlap</span>
                  <span className="legend-item"><span className="legend-dot dot-c" />Shift B+C overlap</span>
                </div>
              </div>
            )}

            {Object.keys(forecastData).length > 0 && (
              <div className="forecast-table-section">
                <h3 className="subsection-title">Loaded Forecast Data</h3>
                <table className="data-table">
                  <thead>
                    <tr><th>Date</th><th>Day</th><th>Forecast Calls (Raw)</th></tr>
                  </thead>
                  <tbody>
                    {Object.entries(forecastData).sort(([a], [b]) => a.localeCompare(b)).slice(-30).map(([dk, count]) => {
                      const date = parseISO(dk);
                      return (
                        <tr key={dk}>
                          <td>{dk}</td>
                          <td>{format(date, 'EEE')}</td>
                          <td>{count.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Settings Tab ── */}
        {activeTab === 'settings' && (
          <div className="tab-content">
            <h2 className="section-title">Settings</h2>

            {/* Date Range */}
            <div className="settings-section">
              <h3>Schedule Period</h3>
              <div className="form-row">
                <div className="form-group">
                  <label>Start Date</label>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="form-input" />
                </div>
                <div className="form-group">
                  <label>End Date</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="form-input" />
                </div>
              </div>
            </div>

            {/* Shift Targets */}
            <div className="settings-section">
              <h3>Default Shift Targets</h3>
              <table className="data-table settings-table">
                <thead>
                  <tr><th>Day Type</th><th>Shift A</th><th>Shift B</th><th>Shift C</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Weekday</td>
                    <td><span className="shift-count shift-count-a">{DEFAULT_TARGETS.weekday.A}</span></td>
                    <td><span className="shift-count shift-count-b">{DEFAULT_TARGETS.weekday.B}</span></td>
                    <td><span className="shift-count shift-count-c">{DEFAULT_TARGETS.weekday.C}</span></td>
                  </tr>
                  <tr>
                    <td>Saturday</td>
                    <td><span className="shift-count shift-count-a">{DEFAULT_TARGETS.saturday.A}</span></td>
                    <td><span className="shift-count shift-count-b">{DEFAULT_TARGETS.saturday.B}</span></td>
                    <td><span className="shift-count shift-count-c">{DEFAULT_TARGETS.saturday.C}</span></td>
                  </tr>
                  <tr>
                    <td>Sunday</td>
                    <td><span className="shift-count shift-count-a">{DEFAULT_TARGETS.sunday.A}</span></td>
                    <td><span className="shift-count shift-count-b">{DEFAULT_TARGETS.sunday.B}</span></td>
                    <td><span className="shift-count shift-count-c">{DEFAULT_TARGETS.sunday.C}</span></td>
                  </tr>
                </tbody>
              </table>
              <p className="settings-note">Peak day overrides (Jul 1, Jul 31): 9A / 0B / 1C — hardcoded per your brief. Full target editor coming in next version.</p>
            </div>

            {/* Manager Roster */}
            <div className="settings-section">
              <div className="section-header-row">
                <h3>Manager Roster ({managers.length})</h3>
                <button className="btn btn-sm btn-secondary" onClick={addManager}>+ Add Manager</button>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Shift Anchor</th>
                    <th>Rotation Offset</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {managers.map((m, i) => (
                    <tr key={m.id}>
                      <td>
                        <input
                          className="inline-input"
                          value={m.name}
                          onChange={e => updateManager(m.id, 'name', e.target.value)}
                        />
                      </td>
                      <td>
                        <select
                          className="inline-select"
                          value={m.shiftAnchor || ''}
                          onChange={e => updateManager(m.id, 'shiftAnchor', e.target.value || null)}
                        >
                          <option value="">Flexible</option>
                          <option value="A">Shift A</option>
                          <option value="B">Shift B</option>
                          <option value="C">Shift C</option>
                        </select>
                      </td>
                      <td>
                        <select
                          className="inline-select"
                          value={m.rotationOffset !== undefined ? m.rotationOffset : ''}
                          onChange={e => updateManager(m.id, 'rotationOffset', e.target.value !== '' ? Number(e.target.value) : undefined)}
                        >
                          <option value="">Auto</option>
                          {[0,1,2,3,4,5,6].map(n => <option key={n} value={n}>Day {n}</option>)}
                        </select>
                      </td>
                      <td>
                        <button className="btn-icon btn-remove" onClick={() => removeManager(m.id)} title="Remove">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
