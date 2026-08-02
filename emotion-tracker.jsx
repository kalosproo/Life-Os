import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

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
  return `entries:${year}-${String(month + 1).padStart(2, '0')}`;
}

function xForDay(day, total) {
  if (total <= 1) return PAD_L + CHART_W / 2;
  return PAD_L + ((day - 1) / (total - 1)) * CHART_W;
}

function yForRating(rating) {
  const r = Math.min(10, Math.max(1, rating));
  return PAD_T + CHART_H - ((r - 1) / 9) * CHART_H;
}

function ratingForY(svgY) {
  const clampedY = Math.min(PAD_T + CHART_H, Math.max(PAD_T, svgY));
  const ratio = (PAD_T + CHART_H - clampedY) / CHART_H;
  return Math.round(1 + ratio * 9);
}

function dayForX(svgX, total) {
  if (total <= 1) return 1;
  const clampedX = Math.min(PAD_L + CHART_W, Math.max(PAD_L, svgX));
  const ratio = (clampedX - PAD_L) / CHART_W;
  return Math.min(total, Math.max(1, Math.round(ratio * (total - 1)) + 1));
}

function buildSmoothPath(points) {
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const midX = (prev.x + curr.x) / 2;
    const midY = (prev.y + curr.y) / 2;
    d += ` Q ${prev.x} ${prev.y} ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
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
  const [selectedDay, setSelectedDay] = useState(null);
  const [exporting, setExporting] = useState(false);
  const svgRef = useRef(null);
  const chipRefs = useRef({});

  const total = daysInMonth(year, month);
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelectedDay(null);
    (async () => {
      try {
        const key = monthKey(year, month);
        const result = await window.storage.get(key, false);
        if (!cancelled) setEntries(result ? JSON.parse(result.value) : {});
      } catch (e) {
        if (!cancelled) setEntries({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [year, month]);

  useEffect(() => {
    if (loading) return;
    const key = monthKey(year, month);
    const data = entries;
    const handle = setTimeout(() => {
      window.storage.set(key, JSON.stringify(data), false).catch(() => {});
    }, 350);
    return () => clearTimeout(handle);
  }, [entries, year, month, loading]);

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

  const svgPointFromEvent = useCallback((e) => {
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const scaleX = VB_W / rect.width;
    const scaleY = VB_H / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const handlePointerDown = useCallback((e) => {
    e.target.setPointerCapture(e.pointerId);
    const { x, y } = svgPointFromEvent(e);
    const day = dayForX(x, total);
    const rating = ratingForY(y);
    setSelectedDay(day);
    setEntries(prev => ({ ...prev, [day]: rating }));
  }, [svgPointFromEvent, total]);

  const handlePointerMove = useCallback((e) => {
    if (e.pointerType === 'mouse' && e.buttons !== 1) return;
    const { x, y } = svgPointFromEvent(e);
    const day = dayForX(x, total);
    const rating = ratingForY(y);
    setSelectedDay(day);
    setEntries(prev => (prev[day] === rating ? prev : { ...prev, [day]: rating }));
  }, [svgPointFromEvent, total]);

  const selectDay = useCallback((day) => {
    setSelectedDay(day);
    setEntries(prev => (prev[day] !== undefined ? prev : { ...prev, [day]: 5 }));
  }, []);

  const handleSliderChange = useCallback((e) => {
    if (selectedDay === null) return;
    const rating = Number(e.target.value);
    setEntries(prev => ({ ...prev, [selectedDay]: rating }));
  }, [selectedDay]);

  const clearSelected = useCallback(() => {
    if (selectedDay === null) return;
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
    ? (Object.values(entries).reduce((a, b) => a + b, 0) / loggedCount).toFixed(1)
    : null;

  const tickDays = useMemo(() => {
    if (total <= 15) return days;
    const set = new Set([1, total]);
    for (let d = 5; d < total; d += 5) set.add(d);
    return Array.from(set).sort((a, b) => a - b);
  }, [days, total]);

  const selectedX = selectedDay !== null ? xForDay(selectedDay, total) : null;
  const selectedY = selectedDay !== null && entries[selectedDay] !== undefined
    ? yForRating(entries[selectedDay])
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
        .et-chart-hit { cursor: crosshair; touch-action: none; }
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
        .et-export-btn:hover:not(:disabled) { background: #FFFFFF; color: #000000; }
        .et-export-btn:disabled { opacity: 0.5; cursor: default; }
        .et-export-btn:focus-visible { outline: 2px solid #FFFFFF; outline-offset: 2px; }
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
            <button className="et-nav-btn" style={styles.navBtn} onClick={goPrev} aria-label="Previous month">‹</button>
            <button className="et-nav-btn" style={styles.navBtn} onClick={goNext} aria-label="Next month">›</button>
          </div>
        </div>

        <div style={styles.statsRow}>
          <span>
            <span>{loggedCount}/{total} DAYS LOGGED</span>
            {avg && <span style={{ marginLeft: 14 }}>AVG {avg}</span>}
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

            {segments.map((seg, i) => (
              <path
                key={i}
                d={buildSmoothPath(seg.map(d => ({ x: xForDay(d, total), y: yForRating(entries[d]) })))}
                fill="none" stroke="#FFFFFF" strokeWidth={2.5} strokeLinecap="round"
              />
            ))}

            {tickDays.map(d => (
              <text key={d} x={xForDay(d, total)} y={VB_H - PAD_B + 20} textAnchor="middle" style={styles.axisLabel}>{d}</text>
            ))}

            {days.map(d => {
              const hasEntry = entries[d] !== undefined;
              const y = hasEntry ? yForRating(entries[d]) : PAD_T + CHART_H;
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
                  {entries[selectedDay]}
                </text>
              </g>
            )}

            <rect
              className="et-chart-hit"
              x={PAD_L} y={PAD_T} width={CHART_W} height={CHART_H}
              fill="transparent"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
            />
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
                aria-label={`Day ${d}${hasEntry ? `, rated ${entries[d]}` : ', not logged'}`}
              >
                {d}
              </button>
            );
          })}
        </div>

        <div style={styles.panel}>
          {selectedDay === null ? (
            <div style={styles.panelPlaceholder}>Choose a day above, or drag on the grid</div>
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
                  value={entries[selectedDay] ?? 5}
                  onChange={handleSliderChange}
                  aria-label={`Emotion rating for day ${selectedDay}`}
                />
                <span style={styles.ratingNum}>{entries[selectedDay] ?? '–'}</span>
              </div>
              {entries[selectedDay] !== undefined && (
                <button className="et-clear-btn" style={styles.clearBtn} onClick={clearSelected}>Clear entry</button>
              )}
            </div>
          )}
        </div>
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
  navGroup: { display: 'flex', gap: 8 },
  navBtn: { width: 34, height: 34, borderRadius: 0, border: '1.5px solid #FFFFFF', background: 'transparent', fontSize: 18, color: '#FFFFFF', cursor: 'pointer' },
  statsRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, letterSpacing: '0.06em', color: '#FFFFFF', marginBottom: 18, fontWeight: 500 },
  exportBtn: { fontSize: 10, letterSpacing: '0.08em', fontWeight: 600, color: '#FFFFFF', background: 'transparent', border: '1.5px solid #FFFFFF', borderRadius: 0, padding: '6px 10px', cursor: 'pointer' },
  svg: { width: '100%', height: 'auto', display: 'block' },
  axisLabel: { fontSize: 10, fill: '#8C8C8C', fontWeight: 500 },
  chipLabel: { fontSize: 11, fill: '#000000', fontWeight: 700 },
  pickerLabel: { fontSize: 11, letterSpacing: '0.1em', color: '#8C8C8C', fontWeight: 600, marginTop: 14, marginBottom: 4 },
  chipBase: { borderRadius: 0, borderWidth: '1.5px', borderStyle: 'solid' },
  chipSelected: { background: '#FFFFFF', color: '#000000', borderColor: '#FFFFFF' },
  chipLogged: { background: 'rgba(255,255,255,0.12)', color: '#FFFFFF', borderColor: '#FFFFFF' },
  chipEmpty: { background: 'transparent', color: 'rgba(255,255,255,0.4)', borderColor: 'rgba(255,255,255,0.25)' },
  hint: { fontSize: 12, color: '#8C8C8C', textAlign: 'center', marginTop: 10, marginBottom: 18 },
  panel: { minHeight: 96, border: '1.5px solid #FFFFFF', borderRadius: 0, padding: 20, background: 'transparent', marginTop: 6 },
  panelPlaceholder: { fontSize: 13, color: '#8C8C8C', textAlign: 'center' },
  panelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  panelDay: { fontSize: 13, fontWeight: 700, color: '#FFFFFF', letterSpacing: '0.06em' },
  closeBtn: { border: 'none', background: 'none', fontSize: 20, color: '#FFFFFF', cursor: 'pointer', lineHeight: 1 },
  sliderRow: { display: 'flex', alignItems: 'center', gap: 16 },
  ratingNum: { fontSize: 24, fontWeight: 700, color: '#FFFFFF', minWidth: 26, textAlign: 'right' },
  clearBtn: { marginTop: 12, border: 'none', background: 'none', fontSize: 12, color: '#FFFFFF', textDecoration: 'underline', cursor: 'pointer', padding: 0 },
};
