import { useState, useEffect } from "react";
import { io } from "socket.io-client";

// ── Real live data from Node.js server via WebSockets ──
function useRealData() {
  const [dbm, setDbm] = useState(3.3);
  const [pir, setPir] = useState(false);
  const [sound, setSound] = useState(0);
  const [alerts, setAlerts] = useState([]);
  const [dbmHistory, setDbmHistory] = useState([]);
  const [activeAlert, setActiveAlert] = useState(null);
  const [status, setStatus] = useState("monitoring");

  useEffect(() => {
    const socket = io(window.location.origin); 
    let tick = 0;

    socket.on("sensor_update", (data) => {
      setDbm(data.dbm);
      setSound(data.sound);
      setPir(data.pir);

      setDbmHistory((h) => {
        tick++;
        return [...h.slice(-39), { t: tick, v: data.dbm }];
      });
    });

    socket.on("alert", (event) => {
      setAlerts((a) => [event, ...a].slice(0, 50)); 
      
      setActiveAlert({
        ...event,
        label: event.type === "PHONE" ? "Mobile phone detected!" : "Tamper attempt detected!"
      });
      setStatus(event.type === "PHONE" ? "alert" : "tamper");

      setTimeout(() => {
        setActiveAlert(null);
        setStatus("monitoring");
        setAlerts((a) => a.map((x) => (x.id === event.id ? { ...x, status: "resolved" } : x)));
      }, 6000);
    });

    return () => socket.disconnect();
  }, []);

  return { dbm, pir, sound, alerts, dbmHistory, activeAlert, status };
}

// ── Mini sparkline chart ──
function DbmChart({ history, threshold }) {
  const W = 340, H = 90;
  const vals = history.map((h) => h.v);
  const min = 0, max = 3.5; 
  const toY = (v) => H - ((v - min) / (max - min)) * H;
  const toX = (i) => (i / (Math.max(1, vals.length - 1))) * W;

  const points = vals.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  const threshY = toY(threshold);

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
      <line x1="0" y1={threshY} x2={W} y2={threshY} stroke="#f59e0b" strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />
      <text x={W - 4} y={threshY - 4} fontSize="9" fill="#f59e0b" textAnchor="end" opacity="0.9">threshold 1.5 V</text>
      <polygon points={`0,${H} ${points} ${W},${H}`} fill="rgba(239,68,68,0.08)" style={{ transition: "all 0.3s ease" }} />
      <polyline points={points} fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinejoin="round" style={{ transition: "all 0.3s ease" }} />
      {vals.length > 0 && (
        <circle cx={toX(vals.length - 1)} cy={toY(vals[vals.length - 1])} r="3" fill={vals[vals.length - 1] <= threshold ? "#ef4444" : "#22c55e"} style={{ transition: "all 0.3s ease" }} />
      )}
    </svg>
  );
}

// ── Gauge arc for RF Voltage ──
function DbmGauge({ value }) {
  const min = 0, max = 3.5;
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const angle = -140 + pct * 280;
  const r = 52, cx = 70, cy = 70;
  const rad = (a) => (a * Math.PI) / 180;
  const arcX = (a) => cx + r * Math.cos(rad(a));
  const arcY = (a) => cy + r * Math.sin(rad(a));

  const startAngle = -140;
  const endAngle = 140;
  const sweepAngle = endAngle - startAngle;
  const filledAngle = startAngle + pct * sweepAngle;

  const arcPath = (from, to) => {
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    return `M ${arcX(from)} ${arcY(from)} A ${r} ${r} 0 ${large} 1 ${arcX(to)} ${arcY(to)}`;
  };

  const color = value <= 1.5 ? "#ef4444" : value <= 2.0 ? "#f59e0b" : "#22c55e";

  return (
    <svg width="140" height="110" viewBox="0 0 140 110" style={{ filter: `drop-shadow(0 0 8px ${color}40)` }}>
      <path d={arcPath(startAngle, endAngle)} fill="none" stroke="#1f2937" strokeWidth="8" strokeLinecap="round" />
      <path d={arcPath(startAngle, filledAngle)} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" style={{ transition: "stroke-dasharray 0.5s ease, stroke 0.5s ease" }} />
      <line x1={cx} y1={cy} x2={cx + (r - 10) * Math.cos(rad(angle))} y2={cy + (r - 10) * Math.sin(rad(angle))} stroke={color} strokeWidth="2" strokeLinecap="round" style={{ transition: "all 0.5s cubic-bezier(0.4, 0, 0.2, 1)" }} />
      <circle cx={cx} cy={cy} r="4" fill={color} style={{ transition: "fill 0.5s ease" }} />
      <text x={cx} y={cy + 26} textAnchor="middle" fontSize="15" fontWeight="700" fill={color} fontFamily="'Courier New', monospace" style={{ transition: "fill 0.5s ease" }}>{value.toFixed(1)}</text>
      <text x={cx} y={cy + 39} textAnchor="middle" fontSize="9" fill="#6b7280" fontFamily="'Courier New', monospace">Volts</text>
    </svg>
  );
}

// ── Main Dashboard ──
export default function Dashboard() {
  const { dbm, pir, sound, alerts, dbmHistory, activeAlert, status } = useRealData();
  const [uptime, setUptime] = useState(0);
  const [now, setNow] = useState(new Date());
  
  // NEW: State for Mobile Bottom Navigation
  const [activeTab, setActiveTab] = useState("live");

  useEffect(() => {
    const iv = setInterval(() => {
      setUptime((u) => u + 1);
      setNow(new Date());
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const fmtUptime = (s) => {
    const h = Math.floor(s / 3600).toString().padStart(2, "0");
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${h}:${m}:${sec}`;
  };

  const phoneAlerts = alerts.filter((a) => a.type === "PHONE").length;
  const tamperAlerts = alerts.filter((a) => a.type === "TAMPER").length;
  const activeAlertsCount = alerts.filter(a => a.status === "active").length;
  
  const isAlert = status === "alert";
  const isTamper = status === "tamper";

  return (
    <div className="app-container">
      {/* --- CSS Injected for Animations & Responsiveness --- */}
      <style>{`
        * { box-sizing: border-box; }
        .app-container {
          background: #0a0c10; min-height: 100vh;
          font-family: 'Courier New', Courier, monospace; color: #e2e8f0;
          position: relative; overflow-x: hidden;
        }
        
        /* Background Effects */
        .scanline {
          position: fixed; inset: 0; pointer-events: none; z-index: 1;
          background-image: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px);
        }
        .flash-overlay {
          position: fixed; inset: 0; z-index: 50; pointer-events: none;
          animation: flashBg 0.8s ease-in-out infinite alternate;
        }

        /* Animations */
        @keyframes flashBg { from { opacity: 0 } to { opacity: 1 } }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes slideDown { from{transform:translateY(-100%);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes slideUpFade { from{transform:translateY(30px);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes pulseAlert { 0%,100%{transform:scale(1)} 50%{transform:scale(1.05)} }

        .blink { animation: blink 1s linear infinite; }
        
        .anim-slide-up {
          animation: slideUpFade 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          opacity: 0;
        }

        /* Modern Glass Cards */
        .glass-card {
          background: rgba(13, 16, 23, 0.7);
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
          border-radius: 12px;
          padding: 20px;
          transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
        }

        /* Layouts */
        .top-header {
          display: flex; justify-content: space-between; align-items: center;
          padding: 16px 5%; border-bottom: 1px solid #1e2430; background: #0d1017;
          flex-wrap: wrap; gap: 12px;
        }
        .main-content { padding: 24px 5%; max-width: 1400px; margin: 0 auto; }
        
        .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
        .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }

        /* Bottom Nav Hidden by default (for Desktop) */
        .bottom-nav { display: none; }
        .section-live, .section-stats, .section-alerts { display: block; margin-bottom: 24px; }

        /* --- SMART MOBILE TABS --- */
        @media (max-width: 900px) {
          .grid-3 { grid-template-columns: 1fr; }
          .grid-4 { grid-template-columns: repeat(2, 1fr); }
          .top-header { flex-direction: column; align-items: flex-start; }
          .app-container { padding-bottom: 80px; } /* Room for bottom nav */
          
          /* Hide all sections by default on mobile */
          .section-live, .section-stats, .section-alerts { display: none; margin-bottom: 0; }
          
          /* Only show the active tab */
          .mobile-active { display: block !important; animation: slideUpFade 0.4s ease forwards; }

          /* --- Style the Bottom Nav - Floating Pill Glass Theme --- */
          .bottom-nav {
            display: grid; grid-template-columns: repeat(3, 1fr);
            position: fixed; 
            
            /* Floats the bar above the bottom edge with Safe Area support */
            bottom: calc(24px + env(safe-area-inset-bottom)); 
            
            /* Pinches the sides inward to create the floating effect */
            left: 5%; right: 5%; 
            z-index: 100;
            
            /* The perfect pill shape */
            border-radius: 32px; 
            padding: 12px 0 10px 0; 
            
            /* The Liquid Glass Magic */
            background: rgba(10, 12, 16, 0.65); 
            backdrop-filter: saturate(180%) blur(24px); 
            -webkit-backdrop-filter: saturate(180%) blur(24px); 
            
            /* 360-degree glass edge reflection and deep drop shadow */
            border: 1px solid rgba(255, 255, 255, 0.08); 
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1);
          }
          
          .nav-tab {
            background: none; border: none; cursor: pointer;
            display: flex; flex-direction: column; align-items: center; gap: 4px;
            color: #475569; transition: color 0.3s; position: relative;
          }
          .nav-tab.active { color: #93c5fd; text-shadow: 0 0 12px rgba(147, 197, 253, 0.4); }
          .nav-tab span.icon { font-size: 20px; filter: grayscale(100%) opacity(60%); transition: all 0.3s; }
          .nav-tab.active span.icon { filter: grayscale(0%) opacity(100%); transform: translateY(-2px); }
          .nav-tab span.label { font-size: 9px; font-weight: 800; letter-spacing: 0.1em; }
          
          /* Sleek Glowing Dot Indicator (Replaces the top line for the pill shape) */
          .nav-indicator {
            position: absolute; bottom: -8px; width: 4px; height: 4px;
            background: #3b82f6; 
            border-radius: 50%;
            box-shadow: 0 0 10px 3px rgba(59, 130, 246, 0.8);
            opacity: 0; transition: opacity 0.3s, transform 0.3s;
          }
          .nav-tab.active .nav-indicator { opacity: 1; transform: translateY(-2px); }

          /* Floating Red Badge */
          .nav-badge {
            position: absolute; top: -6px; right: calc(50% - 22px);
            background: #ef4444; color: white; font-size: 9px; font-weight: 800;
            padding: 2px 6px; border-radius: 12px; 
            box-shadow: 0 4px 10px rgba(239, 68, 68, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.2);
          }

          .nav-tab {
            background: none; border: none; cursor: pointer;
            display: flex; flex-direction: column; align-items: center; gap: 4px;
            color: #475569; transition: color 0.3s; position: relative;
          }
          .nav-tab.active { color: #93c5fd; }
          .nav-tab span.icon { font-size: 22px; filter: grayscale(100%) opacity(60%); transition: all 0.3s; }
          .nav-tab.active span.icon { filter: grayscale(0%) opacity(100%); }
          .nav-tab span.label { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; }
          
          /* The little blue indicator line */
          .nav-indicator {
            position: absolute; top: -12px; width: 30px; height: 3px;
            background: #3b82f6; border-radius: 0 0 4px 4px;
            opacity: 0; transition: opacity 0.3s;
          }
          .nav-tab.active .nav-indicator { opacity: 1; }

          /* Red badge for unread alerts */
          .nav-badge {
            position: absolute; top: -4px; right: calc(50% - 20px);
            background: #ef4444; color: white; font-size: 9px; font-weight: 800;
            padding: 2px 5px; border-radius: 8px; box-shadow: 0 0 8px rgba(239,68,68,0.5);
          }
        }
      `}</style>

      <div className="scanline" />

      {/* Alert flash overlay */}
      {(isAlert || isTamper) && (
        <div className="flash-overlay" style={{ background: isAlert ? "rgba(239,68,68,0.08)" : "rgba(234,179,8,0.08)" }} />
      )}

      <div style={{ position: "relative", zIndex: 2 }}>
        {/* ── Header ── */}
        <header className="top-header">
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 10, height: 10, borderRadius: "50%",
              background: isAlert ? "#ef4444" : isTamper ? "#eab308" : "#22c55e",
              boxShadow: `0 0 12px ${isAlert ? "#ef4444" : isTamper ? "#eab308" : "#22c55e"}`,
              animation: (isAlert || isTamper) ? "blink 0.6s linear infinite" : "none",
            }} />
            <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.2em", color: "#94a3b8" }}>SENTINEL RF</span>
            <span style={{ fontSize: 10, letterSpacing: "0.15em", padding: "4px 8px", border: "1px solid #1e2430", borderRadius: 6, color: "#475569" }}>
              V2.0 MQTT
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 12, color: "#475569", flexWrap: "wrap" }}>
            <span>UPTIME <span style={{ color: "#22c55e" }}>{fmtUptime(uptime)}</span></span>
            <div style={{
              padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 800, letterSpacing: "0.1em",
              background: isAlert ? "#7f1d1d" : isTamper ? "#713f12" : "#064e3b",
              color: isAlert ? "#fca5a5" : isTamper ? "#fef08a" : "#6ee7b7",
              border: `1px solid ${isAlert ? "#ef4444" : isTamper ? "#eab308" : "#059669"}`,
              animation: (isAlert || isTamper) ? "pulseAlert 0.8s ease infinite" : "none",
            }}>
              {isAlert ? "⚠ PHONE DETECTED" : isTamper ? "⚠ TAMPER ALERT" : "● MONITORING SECURE"}
            </div>
          </div>
        </header>

        {/* ── Active Alert Dropdown Banner (Fixed to top of content) ── */}
        <div style={{ position: "sticky", top: 0, zIndex: 40 }}>
          {activeAlert && (
            <div style={{
              background: activeAlert.type === "PHONE" ? "rgba(127, 29, 29, 0.95)" : "rgba(113, 63, 18, 0.95)",
              backdropFilter: "blur(10px)",
              borderBottom: `2px solid ${activeAlert.type === "PHONE" ? "#ef4444" : "#eab308"}`,
              padding: "16px 5%", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px",
              animation: "slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span style={{ fontSize: 24 }}>{activeAlert.type === "PHONE" ? "🚨" : "⚠️"}</span>
                <div>
                  <div className="blink" style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.1em", color: activeAlert.type === "PHONE" ? "#fca5a5" : "#fef08a" }}>
                    {activeAlert.label.toUpperCase()}
                  </div>
                  <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 4 }}>
                    Signal: <b>{activeAlert.dbm} V</b> &nbsp;·&nbsp; Sound: <b>{activeAlert.sound} dB</b>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Main Content Area ── */}
        <main className="main-content">
          
          {/* SECTION 1: LIVE SENSORS */}
          <div className={`section-live ${activeTab === 'live' ? 'mobile-active' : ''}`}>
            <div className="grid-3">
              {/* Card 1: RF Signal */}
              <div className="glass-card anim-slide-up" style={{ border: `1px solid ${dbm <= 1.5 ? "#ef4444" : "#1e2430"}` }}>
                <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.2em", marginBottom: 16, fontWeight: 700 }}>RF SIGNAL · AD8318</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <DbmGauge value={dbm} />
                  <div style={{ flex: 1, paddingLeft: 16 }}>
                    <div style={{ fontSize: 10, color: "#475569", marginBottom: 4 }}>STATUS</div>
                    <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.1em", color: dbm <= 1.5 ? "#ef4444" : dbm <= 2.0 ? "#f59e0b" : "#22c55e", marginBottom: 16 }}>
                      {dbm <= 1.5 ? "PHONE DETECTED" : dbm <= 2.0 ? "WEAK SIGNAL" : "CLEAR"}
                    </div>
                    <div style={{ fontSize: 10, color: "#475569" }}>THRESHOLD</div>
                    <div style={{ fontSize: 13, color: "#f59e0b", fontWeight: 600 }}>1.5 V</div>
                  </div>
                </div>
              </div>

              {/* Card 2: PIR Sensor */}
              <div className="glass-card anim-slide-up" style={{ border: `1px solid ${pir ? "#eab308" : "#1e2430"}` }}>
                <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.2em", marginBottom: 16, fontWeight: 700 }}>PIR SENSOR · HC-SR501</div>
                <div style={{ textAlign: "center", padding: "10px 0" }}>
                  <div style={{
                    width: 80, height: 80, borderRadius: "50%", margin: "0 auto",
                    background: pir ? "rgba(234,179,8,0.15)" : "rgba(34,197,94,0.08)",
                    border: `2px solid ${pir ? "#eab308" : "#22c55e"}`,
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32,
                    boxShadow: pir ? "0 0 30px rgba(234,179,8,0.4)" : "inset 0 0 10px rgba(34,197,94,0.2)",
                  }}>
                    {pir ? "⚠" : "✓"}
                  </div>
                  <div style={{ marginTop: 16, fontSize: 14, fontWeight: 800, letterSpacing: "0.15em", color: pir ? "#eab308" : "#22c55e" }}>
                    {pir ? "MOTION DETECTED" : "AREA CLEAR"}
                  </div>
                </div>
              </div>

              {/* Card 3: Sound Level */}
              <div className="glass-card anim-slide-up" style={{ border: "1px solid #1e2430" }}>
                <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.2em", marginBottom: 16, fontWeight: 700 }}>SOUND LEVEL · KY-037</div>
                <div style={{ fontSize: 42, fontWeight: 800, color: sound >= 70 ? "#ef4444" : sound >= 50 ? "#f59e0b" : "#e2e8f0", textAlign: "center" }}>
                  {sound}<span style={{ fontSize: 16, color: "#64748b", marginLeft: 4 }}>dB</span>
                </div>
                <div style={{ marginTop: 20 }}>
                  {[20, 40, 60, 80, 100].map((bar) => (
                    <div key={bar} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                      <span style={{ fontSize: 10, color: "#475569", width: 24, textAlign: "right" }}>{bar}</span>
                      <div style={{ flex: 1, height: 8, borderRadius: 4, background: "#1e2430", position: "relative" }}>
                        <div style={{
                          position: "absolute", left: 0, top: 0, bottom: 0, width: sound >= bar ? "100%" : "0%",
                          background: bar >= 70 ? "#ef4444" : bar >= 50 ? "#f59e0b" : "#22c55e",
                          transition: "width 0.4s ease, background 0.4s ease",
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: CHARTS AND STATS */}
          <div className={`section-stats ${activeTab === 'stats' ? 'mobile-active' : ''}`}>
            {/* Stats Blocks */}
            <div className="grid-4 anim-slide-up" style={{ marginBottom: 20 }}>
              {[
                { label: "PHONE DETECTIONS", value: phoneAlerts, color: "#ef4444" },
                { label: "TAMPER ALERTS", value: tamperAlerts, color: "#eab308" },
                { label: "SESSION UPTIME", value: fmtUptime(uptime), color: "#22c55e" },
                { label: "CURRENT SIGNAL", value: `${dbm.toFixed(1)} V`, color: dbm <= 1.5 ? "#ef4444" : "#e2e8f0" },
              ].map((s) => (
                <div key={s.label} className="glass-card" style={{ border: "1px solid #1e2430", padding: "16px" }}>
                  <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.15em", marginBottom: 8, fontWeight: 600 }}>{s.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* History Chart */}
            <div className="glass-card anim-slide-up" style={{ border: "1px solid #1e2430" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: "10px" }}>
                <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.2em", fontWeight: 700 }}>RF SIGNAL HISTORY</div>
                <div style={{ display: "flex", gap: 16, fontSize: 10, fontWeight: 600 }}>
                  <span style={{ color: "#22c55e" }}>● SAFE</span>
                  <span style={{ color: "#f59e0b" }}>● THRESHOLD</span>
                  <span style={{ color: "#ef4444" }}>● DETECTED</span>
                </div>
              </div>
              <div style={{ height: "120px", width: "100%" }}>
                <DbmChart history={dbmHistory} threshold={1.5} />
              </div>
            </div>
          </div>

          {/* SECTION 3: ALERTS LOG */}
          <div className={`section-alerts ${activeTab === 'alerts' ? 'mobile-active' : ''}`}>
            <div className="glass-card anim-slide-up" style={{ border: "1px solid #1e2430", minHeight: "300px" }}>
              <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.2em", marginBottom: 16, fontWeight: 700 }}>SYSTEM ALERT LOG</div>
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr 1fr 1fr 2fr", gap: 12, fontSize: 10, color: "#94a3b8", paddingBottom: 12, borderBottom: "1px solid #1e2430", fontWeight: 600 }}>
                  <span>TIME</span><span>TYPE</span><span>RF (V)</span><span>SOUND</span><span>STATUS</span>
                </div>
                <div style={{ overflowY: "auto", overflowX: "hidden", paddingRight: "4px" }}>
                  {alerts.length === 0 ? (
                    <div style={{ padding: "40px 0", textAlign: "center", color: "#475569", fontSize: 12, fontStyle: "italic" }}>No alerts recorded in current session.</div>
                  ) : alerts.map((a) => (
                    <div key={a.id} style={{
                      display: "grid", gridTemplateColumns: "1fr 1.5fr 1fr 1fr 2fr", gap: 12, fontSize: 12,
                      padding: "16px 0", borderBottom: "1px solid #111827",
                      color: a.status === "active" ? (a.type === "PHONE" ? "#fca5a5" : "#fef08a") : "#94a3b8",
                      background: a.status === "active" ? (a.type === "PHONE" ? "rgba(239,68,68,0.05)" : "rgba(234,179,8,0.05)") : "transparent",
                    }}>
                      <span style={{ color: "#64748b" }}>{a.timeStr || a.time}</span>
                      <span style={{ fontWeight: 800, color: a.type === "PHONE" ? (a.status === "active" ? "#ef4444" : "#991b1b") : (a.status === "active" ? "#eab308" : "#854d0e") }}>
                        {a.type === "PHONE" ? "📡 PHONE" : "⚠ TAMPER"}
                      </span>
                      <span style={{ color: a.dbm <= 1.5 ? "#ef4444" : "inherit" }}>{a.dbm}</span>
                      <span>{a.sound} dB</span>
                      <span style={{ fontSize: 10, letterSpacing: "0.1em", fontWeight: 800, color: a.status === "active" ? "#22c55e" : "#475569" }}>
                        {a.status === "active" ? "● ACTIVE" : "○ RESOLVED"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* ── MOBILE BOTTOM NAVIGATION (Hidden on Desktop) ── */}
      <nav className="bottom-nav">
        <button className={`nav-tab ${activeTab === 'live' ? 'active' : ''}`} onClick={() => setActiveTab('live')}>
          <div className="nav-indicator" />
          <span className="icon">📡</span>
          <span className="label">LIVE</span>
        </button>
        
        <button className={`nav-tab ${activeTab === 'stats' ? 'active' : ''}`} onClick={() => setActiveTab('stats')}>
          <div className="nav-indicator" />
          <span className="icon">📈</span>
          <span className="label">STATS</span>
        </button>
        
        <button className={`nav-tab ${activeTab === 'alerts' ? 'active' : ''}`} onClick={() => setActiveTab('alerts')}>
          <div className="nav-indicator" />
          {activeAlertsCount > 0 && <div className="nav-badge">{activeAlertsCount}</div>}
          <span className="icon">🔔</span>
          <span className="label">ALERTS</span>
        </button>
      </nav>
    </div>
  );
}