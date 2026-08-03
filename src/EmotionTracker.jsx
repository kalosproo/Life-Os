import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';
import BlackBoxCard from './BlackBoxCard';

const VB_W = 1000;
const VB_H = 380;
const PAD_L = 46;
const PAD_R = 26;
const PAD_T = 28;
const PAD_B = 46;
const CHART_W = VB_W - PAD_L - PAD_R;
const CHART_H = VB_H - PAD_T - PAD_B;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function localMonthKey(year, month) {
  return `entries:${monthKey(year, month)}`;
}

function normalizeEntries(value) {
  return Object.fromEntries(
    Object.entries(value || {})
      .map(([day, entry]) => {
        const rating = typeof entry === 'number' ? entry : Number(entry?.rating);
        const rawNote = typeof entry === 'object' && entry !== null ? entry.note : '';
        const note = typeof rawNote === 'string' ? rawNote.slice(0, 200) : '';
        return [String(Number(day)), { rating, note }];
      })
      .filter(([day, entry]) => Number(day) >= 1 && Number(day) <= 31 && entry.rating >= 1 && entry.rating <= 10),
  );
}

function entryRating(entry) {
  return entry?.rating;
}

function xForDay(day, total) {
  if (total <= 1) return PAD_L + CHART_W / 2;
  return PAD_L + ((day - 1) / (total - 1)) * CHART_W;
}

function yForRating(rating) {
  const r = Math.min(10, Math.max(1, rating));
  return PAD_T + CHART_H - ((r - 1) / 9) * CHART_H;
}


function buildSmoothPath(points) {
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const prev = points[i - 1] || points[i];
    const curr = points[i];
    const next = points[i + 1];
    const after = points[i + 2] || next;
    const cp1x = curr.x + (next.x - prev.x) / 6;
    const cp1y = curr.y + (next.y - prev.y) / 6;
    const cp2x = next.x - (after.x - curr.x) / 6;
    const cp2y = next.y - (after.y - curr.y) / 6;
    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${next.x} ${next.y}`;
  }
  return d;
}

function buildAreaPath(points) {
  if (points.length < 2) return '';
  const baseline = PAD_T + CHART_H;
  const linePath = buildSmoothPath(points);
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
}

function groupConsecutive(days, entries) {
  const segments = [];
  let current = [];
  for (const day of days) {
    if (entries[day] !== undefined) {
      current.push(day);
    } else {
      if (current.length) segments.push(current);
      current = [];
    }
  }
  if (current.length) segments.push(current);
  return segments;
}

export default function EmotionTracker() {
  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [entries, setEntries] = useState({});
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Local mode');
  const [selectedDay, setSelectedDay] = useState(null);
  const [exporting, setExporting] = useState(false);
  const svgRef = useRef(null);
  const chipRefs = useRef({});
  const hasUserEditedRef = useRef(false);

  const total = daysInMonth(year, month);
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser);
    setAuthReady(true);
  }), []);

  useEffect(() => {
    if (!authReady) return undefined;
    let cancelled = false;
    setLoading(true);
    setSelectedDay(null);
    hasUserEditedRef.current = false;
    (async () => {
      try {
        if (user) {
          const snap = await getDoc(doc(db, 'users', user.uid, 'emotionMonths', monthKey(year, month)));
          if (!cancelled) {
            setEntries(snap.exists() ? normalizeEntries(snap.data().entries) : {});
            setSyncStatus('Synced with Firestore');
          }
        } else {
          const raw = window.localStorage.getItem(localMonthKey(year, month));
          if (!cancelled) {
            setEntries(raw ? normalizeEntries(JSON.parse(raw)) : {});
            setSyncStatus('Saved on this device');
          }
        }
      } catch (e) {
        if (!cancelled) {
          setEntries({});
          setSyncStatus('Unable to load saved data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authReady, user, year, month]);

  useEffect(() => {
    if (loading || !authReady || !hasUserEditedRef.current) return undefined;
    const data = normalizeEntries(entries);
    const handle = setTimeout(async () => {
      try {
        if (user) {
          await setDoc(doc(db, 'users', user.uid, 'emotionMonths', monthKey(year, month)), {
            entries: data,
            updatedAt: serverTimestamp(),
          }, { merge: true });
          setSyncStatus('Synced with Firestore');
        } else {
          window.localStorage.setItem(localMonthKey(year, month), JSON.stringify(data));
          setSyncStatus('Saved on this device');
        }
      } catch (e) {
        setSyncStatus('Sync failed — changes kept on screen');
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [entries, year, month, loading, authReady, user]);

  useEffect(() => {
    if (selectedDay === null) return;
    const el = chipRefs.current[selectedDay];
    if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedDay]);

  const goPrev = useCallback(() => {
    setMonth(m => {
      if (m === 0) { setYear(y => y - 1); return 11; }
      return m - 1;
    });
  }, []);

  const goNext = useCallback(() => {
    setMonth(m => {
      if (m === 11) { setYear(y => y + 1); return 0; }
      return m + 1;
    });
  }, []);

  const days = useMemo(() => Array.from({ length: total }, (_, i) => i + 1), [total]);
  const segments = useMemo(() => groupConsecutive(days, entries), [days, entries]);


  const selectDay = useCallback((day) => {
    setSelectedDay(day);
  }, []);

  const handleSliderChange = useCallback((e) => {
    if (selectedDay === null) return;
    const rating = Number(e.target.value);
    hasUserEditedRef.current = true;
    setEntries(prev => ({
      ...prev,
      [selectedDay]: { rating, note: prev[selectedDay]?.note || '' },
    }));
  }, [selectedDay]);

  const handleNoteChange = useCallback((e) => {
    if (selectedDay === null) return;
    const note = e.target.value.slice(0, 200);
    setEntries(prev => {
      if (prev[selectedDay] === undefined) return prev;
      hasUserEditedRef.current = true;
      return {
        ...prev,
        [selectedDay]: { rating: prev[selectedDay].rating, note },
      };
    });
  }, [selectedDay]);

  const signIn = useCallback(async () => {
    setAuthBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const signOutUser = useCallback(async () => {
    setAuthBusy(true);
    try {
      await signOut(auth);
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const clearSelected = useCallback(() => {
    if (selectedDay === null) return;
    hasUserEditedRef.current = true;
    setEntries(prev => {
      const copy = { ...prev };
      delete copy[selectedDay];
      return copy;
    });
  }, [selectedDay]);

  const exportPNG = useCallback(() => {
    const svgEl = svgRef.current;
    if (!svgEl || exporting) return;
    setExporting(true);
    try {
      const scale = 2;
      const headerH = 60;
      const outW = VB_W * scale;
      const outH = (VB_H + headerH) * scale;

      const clone = svgEl.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(VB_W));
      clone.setAttribute('height', String(VB_H));

      const svgString = new XMLSerializer().serializeToString(clone);
      const svg64 = btoa(unescape(encodeURIComponent(svgString)));
      const imgSrc = 'data:image/svg+xml;base64,' + svg64;

      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = outW;
          canvas.height = outH;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, outW, outH);
          ctx.fillStyle = '#FFFFFF';
          ctx.textBaseline = 'middle';
          ctx.font = `600 ${16 * scale}px -apple-system, Helvetica, Arial, sans-serif`;
          ctx.fillText(`${MONTH_NAMES[month].toUpperCase()} ${year} — EMOTION TRACKER`, 16 * scale, (headerH * scale) / 2);
          ctx.drawImage(img, 0, headerH * scale, outW, VB_H * scale);
          canvas.toBlob(blob => {
            setExporting(false);
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `emotion-tracker-${year}-${String(month + 1).padStart(2, '0')}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 'image/png');
        } catch (err) {
          setExporting(false);
        }
      };
      img.onerror = () => setExporting(false);
      img.src = imgSrc;
    } catch (err) {
      setExporting(false);
    }
  }, [month, year, exporting]);

  const loggedCount = Object.keys(entries).length;
  const avg = loggedCount
    ? (Object.values(entries).reduce((a, entry) => a + entry.rating, 0) / loggedCount).toFixed(1)
    : null;

  const tickDays = useMemo(() => {
    if (total <= 15) return days;
    const set = new Set([1, total]);
    for (let d = 5; d < total; d += 5) set.add(d);
    return Array.from(set).sort((a, b) => a - b);
  }, [days, total]);

  const selectedX = selectedDay !== null ? xForDay(selectedDay, total) : null;
  const selectedY = selectedDay !== null && entries[selectedDay] !== undefined
    ? yForRating(entryRating(entries[selectedDay]))
    : null;
  const bandWidth = CHART_W / Math.max(total - 1, 1);

  return (
    <div style={styles.page}>
      <style>{`
        .et-root, .et-root * { font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif; box-sizing: border-box; }
        .et-nav-btn { transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease; }
        .et-nav-btn:hover { background: #FFFFFF; color: #000000; }
        .et-nav-btn:active { transform: scale(0.9); }
        .et-nav-btn:focus-visible { outline: 2px solid #FFFFFF; outline-offset: 2px; }
        .et-fade { transition: opacity 0.3s ease; }
        .et-chip-row { display: flex; gap: 6px; overflow-x: auto; padding: 4px 2px 10px 2px; scrollbar-width: thin; }
        .et-chip-row::-webkit-scrollbar { height: 4px; }
        .et-chip-row::-webkit-scrollbar-thumb { background: #333333; }
        .et-chip { flex: 0 0 auto; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease; }
        .et-chip:focus-visible { outline: 2px solid #FFFFFF; outline-offset: 2px; }
        .et-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 3px; border-radius: 0; background: #333333; outline: none; }
        .et-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 20px; height: 20px; border-radius: 50%; background: #FFFFFF; border: 3px solid #000000; box-shadow: 0 0 0 1.5px #FFFFFF; cursor: pointer; }
        .et-slider::-moz-range-thumb { width: 20px; height: 20px; border-radius: 50%; background: #FFFFFF; border: 3px solid #000000; box-shadow: 0 0 0 1.5px #FFFFFF; cursor: pointer; }
        .et-slider:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 1.5px #FFFFFF, 0 0 0 5px rgba(255,255,255,0.25); }
        .et-export-btn { transition: background 0.15s ease, color 0.15s ease; }
        .et-export-btn:hover:not(:disabled), .et-login-btn:hover:not(:disabled) { background: #FFFFFF; color: #000000; }
        .et-export-btn:disabled, .et-login-btn:disabled { opacity: 0.5; cursor: default; }
        .et-export-btn:focus-visible, .et-login-btn:focus-visible { outline: 2px solid #FFFFFF; outline-offset: 2px; }
        .et-clear-btn:hover { opacity: 0.6; }
        .et-close-btn:hover { opacity: 0.5; }
        .et-close-btn:focus-visible, .et-clear-btn:focus-visible { outline: 2px solid #FFFFFF; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) {
          .et-root * { transition: none !important; }
        }
      `}</style>
      <div className="et-root" style={styles.card}>
        <div style={styles.header}>
          <div>
            <div style={styles.eyebrow}>Emotion Tracker</div>
            <div style={styles.title}>{MONTH_NAMES[month]} {year}</div>
          </div>
          <div style={styles.navGroup}>
            <button className="et-login-btn" style={styles.loginBtn} onClick={user ? signOutUser : signIn} disabled={!authReady || authBusy}>
              {user ? 'SIGN OUT' : 'GOOGLE LOGIN'}
            </button>
            <button className="et-nav-btn" style={styles.navBtn} onClick={goPrev} aria-label="Previous month">‹</button>
            <button className="et-nav-btn" style={styles.navBtn} onClick={goNext} aria-label="Next month">›</button>
          </div>
        </div>

        <div style={styles.statsRow}>
          <span>
            <span>{loggedCount}/{total} DAYS LOGGED</span>
            {avg && <span style={{ marginLeft: 14 }}>AVG {avg}</span>}
            <span style={{ marginLeft: 14 }}>{syncStatus}</span>
          </span>
          <button
            className="et-export-btn"
            style={styles.exportBtn}
            onClick={exportPNG}
            disabled={exporting}
          >
            {exporting ? 'EXPORTING…' : 'EXPORT PNG'}
          </button>
        </div>

        <div className="et-fade" style={{ opacity: loading ? 0.35 : 1 }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            style={styles.svg}
            preserveAspectRatio="xMidYMid meet"
          >
            {selectedX !== null && (
              <rect
                x={selectedX - bandWidth / 2} y={PAD_T}
                width={bandWidth} height={CHART_H}
                fill="#1A1A1A"
              />
            )}

            {days.map(d => (
              <line
                key={`v${d}`}
                x1={xForDay(d, total)} x2={xForDay(d, total)}
                y1={PAD_T} y2={PAD_T + CHART_H}
                stroke="#FFFFFF" strokeOpacity={0.08}
              />
            ))}

            {Array.from({ length: 10 }, (_, i) => i + 1).map(r => (
              <g key={r}>
                <line
                  x1={PAD_L} x2={VB_W - PAD_R}
                  y1={yForRating(r)} y2={yForRating(r)}
                  stroke="#FFFFFF" strokeOpacity={r === 1 || r === 10 ? 0.25 : 0.08}
                />
                <text x={PAD_L - 10} y={yForRating(r) + 3} textAnchor="end" style={styles.axisLabel}>{r}</text>
              </g>
            ))}

            <rect x={PAD_L} y={PAD_T} width={CHART_W} height={CHART_H} fill="none" stroke="#FFFFFF" strokeWidth={1.5} />

            {isCurrentMonth && (
              <line
                x1={xForDay(today.getDate(), total)} x2={xForDay(today.getDate(), total)}
                y1={PAD_T} y2={PAD_T + CHART_H}
                stroke="#FFFFFF" strokeWidth={1} strokeDasharray="2 3"
              />
            )}

            {selectedX !== null && selectedY !== null && (
              <>
                <line x1={PAD_L} x2={selectedX} y1={selectedY} y2={selectedY} stroke="#FFFFFF" strokeWidth={1} strokeDasharray="2 3" />
                <line x1={selectedX} x2={selectedX} y1={selectedY} y2={PAD_T + CHART_H} stroke="#FFFFFF" strokeWidth={1} strokeDasharray="2 3" />
              </>
            )}

            {segments.map((seg, i) => {
              const points = seg.map(d => ({ x: xForDay(d, total), y: yForRating(entryRating(entries[d])) }));
              if (points.length < 2) return null;
              return (
                <path
                  key={`area${i}`}
                  d={buildAreaPath(points)}
                  fill="#FFFFFF"
                  fillOpacity={0.12}
                  stroke="none"
                />
              );
            })}

            {segments.map((seg, i) => (
              <path
                key={i}
                d={buildSmoothPath(seg.map(d => ({ x: xForDay(d, total), y: yForRating(entryRating(entries[d])) })))}
                fill="none" stroke="#FFFFFF" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
              />
            ))}

            {tickDays.map(d => (
              <text key={d} x={xForDay(d, total)} y={VB_H - PAD_B + 20} textAnchor="middle" style={styles.axisLabel}>{d}</text>
            ))}

            {days.map(d => {
              const hasEntry = entries[d] !== undefined;
              const y = hasEntry ? yForRating(entryRating(entries[d])) : PAD_T + CHART_H;
              const isSelected = selectedDay === d;
              return (
                <circle
                  key={d}
                  cx={xForDay(d, total)} cy={y}
                  r={isSelected ? 6.5 : hasEntry ? 4 : 3}
                  fill={hasEntry ? '#FFFFFF' : '#000000'}
                  stroke="#FFFFFF"
                  strokeWidth={hasEntry ? 0 : 1.5}
                />
              );
            })}

            {selectedX !== null && selectedY !== null && (
              <g>
                <rect x={selectedX - 14} y={selectedY - 28} width={28} height={20} rx={3} fill="#FFFFFF" />
                <text x={selectedX} y={selectedY - 14} textAnchor="middle" style={styles.chipLabel}>
                  {entryRating(entries[selectedDay])}
                </text>
              </g>
            )}

          </svg>
        </div>

        <div style={styles.pickerLabel}>CHOOSE A DAY</div>
        <div className="et-chip-row">
          {days.map(d => {
            const hasEntry = entries[d] !== undefined;
            const isSelected = selectedDay === d;
            let chipStyle = styles.chipBase;
            if (isSelected) chipStyle = { ...chipStyle, ...styles.chipSelected };
            else if (hasEntry) chipStyle = { ...chipStyle, ...styles.chipLogged };
            else chipStyle = { ...chipStyle, ...styles.chipEmpty };
            return (
              <button
                key={d}
                ref={el => { chipRefs.current[d] = el; }}
                className="et-chip"
                style={chipStyle}
                onClick={() => selectDay(d)}
                aria-label={`Day ${d}${hasEntry ? `, rated ${entryRating(entries[d])}` : ', not logged'}`}
              >
                {d}
              </button>
            );
          })}
        </div>

        <div style={styles.panel}>
          {selectedDay === null ? (
            <div style={styles.panelPlaceholder}>Choose a day above</div>
          ) : (
            <div>
              <div style={styles.panelHeader}>
                <span style={styles.panelDay}>DAY {selectedDay}</span>
                <button className="et-close-btn" style={styles.closeBtn} onClick={() => setSelectedDay(null)} aria-label="Close">×</button>
              </div>
              <div style={styles.sliderRow}>
                <input
                  type="range" min={1} max={10} step={1}
                  className="et-slider"
                  value={entryRating(entries[selectedDay]) ?? 5}
                  onChange={handleSliderChange}
                  aria-label={`Emotion rating for day ${selectedDay}`}
                />
                <span style={styles.ratingNum}>{entryRating(entries[selectedDay]) ?? '–'}</span>
              </div>
              <textarea
                style={styles.noteInput}
                value={entries[selectedDay]?.note || ''}
                onChange={handleNoteChange}
                maxLength={200}
                placeholder={entries[selectedDay] === undefined ? "Set a rating to add a note" : "Optional note (200 characters max)"}
                disabled={entries[selectedDay] === undefined}
                aria-label={`Optional note for day ${selectedDay}`}
              />
              <div style={styles.noteCount}>{(entries[selectedDay]?.note || '').length}/200</div>
              {entries[selectedDay] !== undefined && (
                <button className="et-clear-btn" style={styles.clearBtn} onClick={clearSelected}>Clear entry</button>
              )}
            </div>
          )}
        </div>

        <BlackBoxCard
          enabled={Boolean(isCurrentMonth && entries[today.getDate()] !== undefined)}
          todayKey={todayKey}
        />
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#000000', display: 'flex', justifyContent: 'center', padding: '32px 16px' },
  card: { width: '100%', maxWidth: 640 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 },
  eyebrow: { fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#FFFFFF', marginBottom: 4, fontWeight: 600 },
  title: { fontSize: 28, fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.02em' },
  navGroup: { display: 'flex', gap: 8, alignItems: 'center' },
  navBtn: { width: 34, height: 34, borderRadius: 0, border: '1.5px solid #FFFFFF', background: 'transparent', fontSize: 18, color: '#FFFFFF', cursor: 'pointer' },
  statsRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, letterSpacing: '0.06em', color: '#FFFFFF', marginBottom: 18, fontWeight: 500 },
  exportBtn: { fontSize: 10, letterSpacing: '0.08em', fontWeight: 600, color: '#FFFFFF', background: 'transparent', border: '1.5px solid #FFFFFF', borderRadius: 0, padding: '6px 10px', cursor: 'pointer' },
  loginBtn: { fontSize: 10, letterSpacing: '0.08em', fontWeight: 700, color: '#FFFFFF', background: 'transparent', border: '1.5px solid #FFFFFF', borderRadius: 0, padding: '9px 10px', cursor: 'pointer' },
  svg: { width: '100%', height: 'auto', display: 'block' },
  axisLabel: { fontSize: 10, fill: '#8C8C8C', fontWeight: 500 },
  chipLabel: { fontSize: 11, fill: '#000000', fontWeight: 700 },
  pickerLabel: { fontSize: 11, letterSpacing: '0.1em', color: '#8C8C8C', fontWeight: 600, marginTop: 14, marginBottom: 4 },
  chipBase: { borderRadius: 0, borderWidth: '1.5px', borderStyle: 'solid' },
  chipSelected: { background: '#FFFFFF', color: '#000000', borderColor: '#FFFFFF' },
  chipLogged: { background: 'rgba(255,255,255,0.12)', color: '#FFFFFF', borderColor: '#FFFFFF' },
  chipEmpty: { background: 'transparent', color: 'rgba(255,255,255,0.4)', borderColor: 'rgba(255,255,255,0.25)' },
  hint: { fontSize: 12, color: '#8C8C8C', textAlign: 'center', marginTop: 10, marginBottom: 18 },
  panel: { border: '1.5px solid #FFFFFF', borderRadius: 0, padding: 20, background: 'transparent', marginTop: 6 },
  panelPlaceholder: { fontSize: 13, color: '#8C8C8C', textAlign: 'center' },
  panelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  panelDay: { fontSize: 13, fontWeight: 700, color: '#FFFFFF', letterSpacing: '0.06em' },
  closeBtn: { border: 'none', background: 'none', fontSize: 20, color: '#FFFFFF', cursor: 'pointer', lineHeight: 1 },
  sliderRow: { display: 'flex', alignItems: 'center', gap: 16 },
  ratingNum: { fontSize: 24, fontWeight: 700, color: '#FFFFFF', minWidth: 26, textAlign: 'right' },
  noteInput: { width: '100%', minHeight: 70, marginTop: 16, border: '1.5px solid #FFFFFF', borderRadius: 0, padding: 10, background: 'transparent', color: '#FFFFFF', fontSize: 13, resize: 'vertical', outline: 'none' },
  noteCount: { marginTop: 6, fontSize: 11, color: '#8C8C8C', textAlign: 'right' },
  clearBtn: { marginTop: 12, border: 'none', background: 'none', fontSize: 12, color: '#FFFFFF', textDecoration: 'underline', cursor: 'pointer', padding: 0 },
};
