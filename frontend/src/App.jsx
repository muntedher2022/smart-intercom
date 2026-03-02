import React, { useEffect, useState, useRef, useCallback } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { socket, reconnectSocket } from "./socket";
import { login, clearAuth, isLoggedIn, verifyToken, getUser, changePassword, authFetch, SERVER_URL, API_BASE, getToken, LOGO_PATH, getSoundPath } from "./auth";
import {
  Bell, Coffee, User, Utensils, ShieldCheck, Send, Volume2,
  Briefcase, Settings, X, Plus, Trash2, LogOut, Lock, Eye, EyeOff,
  KeyRound, History, BarChart2, Wifi, WifiOff, CheckCircle2,
  Clock, AlertCircle, RefreshCw, Trash, Calendar, Mic, Square, Database, ShieldAlert,
  FileText, UploadCloud, Search, Download
} from "lucide-react";

// ══════════════════════════════════════════════════════════════════════════════
// مكوّنات مساعدة
// ══════════════════════════════════════════════════════════════════════════════

const getLocalDate = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// ─── ميزة إشعارات النظام الأصلية ───
const PUBLIC_VAPID_KEY = "BA6Mkf4MY9gZi2B58Qi_qSG8ubqVgHABy_A1sNILNLltBf7AutX8YO_X32FCnTMlpdPBUJzGFfg9h7WPBW_QzJE";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const subscribeToPush = async () => {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
    });

    await authFetch('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription),
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('✅ تم تفعيل إشعارات الدفع (Web Push) للجهاز');
    // إخطار المستخدم بنجاح العملية
    localStorage.setItem("web_push_enabled", "true");
  } catch (err) {
    console.error('❌ فشل الاشتراك في إشعارات الدفع:', err);
  }
};

const requestNotificationPermission = async () => {
  if ("Notification" in window) {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      subscribeToPush(); // تفعيل Web Push فور الحصول على الإذن
    }
  }
};

const showNativeNotification = (title, body) => {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, {
      body,
      icon: LOGO_PATH,
      dir: "rtl",
      badge: LOGO_PATH
    });
  }
};

// ─── ميزة إشعار الصمت لإبقاء التطبيق حياً في الخلفية (Silent Audio Keep-Alive + Heartbeat) ───
// ملف صامت مدته ثانية واحدة تقريباً لضمان استقرار التكرار
// ملف صامت تم اختياره بعناية ليكون متوافقاً مع الهواتف دون إحداث فرقعة صوتية (Real Silent Data URI)
const SILENT_AUDIO_BASE64 = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAgLsAAAB3AAACABAAZGF0YQQAAAD//w==";
let silentAudioElement = null;
// lastHeartbeatTime

// ─── ميزة Heartbeat المعززة (إشارات نبض الحياة) ───────────────────────────────────
// نستخدم Beacon لضمان وصول الطلب حتى لو أغلقت النافذة أو اختفت
const performHeartbeat = (onSuccess) => {
  const url = `${API_BASE}/api/auth/heartbeat`;
  const token = getToken();
  if (!token) return;

  if ('sendBeacon' in navigator) {
    try {
      const blob = new Blob([JSON.stringify({ token })], { type: 'application/json' });
      if (navigator.sendBeacon(url, blob)) {
        // Beacon is fire-and-forget, but we still trigger local refresh logic
        if (onSuccess) onSuccess({ pendingCount: 0 });
        return;
      }
    } catch { /* ignore */ }
  }

  authFetch(url, { method: "POST" })
    .then(r => r.ok ? r.json() : null)
    .then(data => { if (data && onSuccess) onSuccess(data); })
    .catch(() => { });
};

const startSilentKeepAlive = (onHeartbeatTick) => {
  if (!silentAudioElement) {
    silentAudioElement = new Audio(SILENT_AUDIO_BASE64);
    silentAudioElement.loop = true;
    silentAudioElement.volume = 0.01;
  }

  const playAttempt = () => { silentAudioElement.play().catch(() => { }); };
  playAttempt();

  let _lastHeartbeatTime = 0; // used to track heartbeat timing

  const triggerHeartbeat = () => {
    performHeartbeat(() => {
      if (onHeartbeatTick) onHeartbeatTick();
      _lastHeartbeatTime = Date.now();

    });
  };


  if (window.__heartbeatInterval) clearInterval(window.__heartbeatInterval);
  window.__heartbeatInterval = setInterval(triggerHeartbeat, 30000);

  // تخزين الوظيفة عالمياً لإجبار تشغيلها عند العودة
  window.__forceTriggerHeartbeat = triggerHeartbeat;

  if ('locks' in navigator) {
    navigator.locks.request('app_presence_lock', { ifAvailable: true }, async (lock) => {
      if (lock) await new Promise(() => { });
    }).catch(() => { });
  }
};

const _stopSilentKeepAlive = () => {

  if (silentAudioElement) {
    silentAudioElement.pause();
    silentAudioElement.onended = null;
    silentAudioElement = null;
  }
};


const FullScreenWrapper = ({ children }) => {
  useEffect(() => {
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    document.body.style.backgroundColor = "#0f172a";
    document.documentElement.style.overflowX = "hidden";
    document.body.style.overflowX = "hidden";
  }, []);
  return (
    <div style={{
      width: "100vw", minHeight: "100vh", display: "flex",
      flexDirection: "column", alignItems: "center",
      boxSizing: "border-box", backgroundColor: "#0f172a",
    }}>
      {children}
    </div>
  );
};

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return isMobile;
};

// Toast للإشعارات
const CustomToast = ({ message, visible, type = "info" }) => {
  const colors = { info: "#3b82f6", success: "#22c55e", error: "#ef4444", warning: "#f59e0b" };
  const icons = { info: <Bell size={16} />, success: <CheckCircle2 size={16} />, error: <AlertCircle size={16} />, warning: <AlertCircle size={16} /> };
  return (
    <div style={{
      position: "fixed", top: "20px", left: "50%",
      transform: `translateX(-50%) translateY(${visible ? "0" : "-120px"})`,
      opacity: visible ? 1 : 0, transition: "all 0.45s cubic-bezier(0.34,1.56,0.64,1)",
      zIndex: 99999, backgroundColor: "#1e293b",
      border: `1px solid ${colors[type]}`,
      padding: "13px 24px", borderRadius: "14px", color: "white",
      boxShadow: `0 15px 45px rgba(0,0,0,0.6)`,
      display: "flex", alignItems: "center", gap: "10px", fontWeight: "600",
      fontSize: "0.95rem", maxWidth: "90vw",
    }}>
      <span style={{ color: colors[type] }}>{icons[type]}</span>
      {message}
    </div>
  );
};

// مؤشر حالة الاتصال بالسيرفر
const ConnectionBadge = ({ connected }) => {
  const [effective, setEffective] = useState(connected);

  useEffect(() => {
    if (connected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEffective(true);
    } else {
      const t = setTimeout(() => setEffective(false), 300000);
      return () => clearTimeout(t);
    }
  }, [connected]);


  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "10px", padding: "8px 20px",
      borderRadius: "25px", backgroundColor: effective ? "rgba(20, 83, 45, 0.2)" : "rgba(127, 29, 29, 0.2)",
      border: `1px solid ${effective ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
      backdropFilter: "blur(12px)", transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
    }}>
      <div style={{
        width: "10px", height: "10px", borderRadius: "50%",
        backgroundColor: effective ? "#22c55e" : "#ef4444",
        boxShadow: effective ? "0 0 12px #22c55e" : "0 0 8px #ef4444",
        animation: effective ? "pulse 2s infinite" : "none"
      }} />
      <style>{`@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }`}</style>
      <span style={{ color: "white", fontSize: "0.9rem", fontWeight: "bold", letterSpacing: "0.5px" }}>
        {effective ? "النظام نشط (تنبيهات فورية)" : "جاري تأمين الاتصال..."}
      </span>
    </div>
  );
};

// بادج حالة الطلب
const StatusBadge = ({ status }) => {
  const map = {
    pending: { color: "#f59e0b", bg: "#78350f33", label: "في الانتظار", icon: <Clock size={12} /> },
    received: { color: "#3b82f6", bg: "#1e3a5f33", label: "تم الاستلام", icon: <CheckCircle2 size={12} /> },
    completed: { color: "#22c55e", bg: "#14532d33", label: "مكتمل", icon: <CheckCircle2 size={12} /> },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "5px",
      padding: "3px 9px", borderRadius: "8px", fontSize: "0.75rem",
      fontWeight: "600", color: s.color, backgroundColor: s.bg,
      border: `1px solid ${s.color}44`,
    }}>
      {s.icon} {s.label}
    </span>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// النغمات المتاحة
// ══════════════════════════════════════════════════════════════════════════════
const CustomDatePicker = ({ value, onChange, label, style = {} }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // دالة لتحليل التاريخ المختار أو التاريخ الحالي
  const d = value ? new Date(value) : new Date();
  const [viewMonth, setViewMonth] = useState(d.getMonth());
  const [viewYear, setViewYear] = useState(d.getFullYear());

  const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  const daysOfWeek = ["ح", "ن", "ث", "ر", "خ", "ج", "س"];

  const getDaysInMonth = (m, y) => new Date(y, m + 1, 0).getDate();
  const getFirstDayOfMonth = (m, y) => new Date(y, m, 1).getDay();

  const handleSelect = (day) => {
    const formatted = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    onChange(formatted);
    setIsOpen(false);
  };

  const nextMonth = (e) => {
    e.stopPropagation();
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const prevMonth = (e) => {
    e.stopPropagation();
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };

  const displayDate = () => {
    if (!value) return "اختر التاريخ";
    const parts = value.split("-");
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const totalDays = getDaysInMonth(viewMonth, viewYear);
  const firstDay = getFirstDayOfMonth(viewMonth, viewYear);
  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= totalDays; i++) days.push(i);

  return (
    <div ref={containerRef} style={{ position: "relative", ...style }}>
      {label && <label style={{ display: "block", color: "#94a3b8", fontSize: "0.85rem", marginBottom: 8, textAlign: "right" }}>{label}</label>}

      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "100%", height: "100%", minHeight: 45, padding: "0 15px", borderRadius: "14px", border: "1px solid #334155",
          backgroundColor: "#0f172a", color: "white", fontSize: "1rem", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10, position: "relative",
          boxSizing: "border-box"
        }}>
        <Calendar size={18} color="#3b82f6" />
        <span style={{ fontFamily: "'Tajawal', sans-serif", whiteSpace: "nowrap" }}>{displayDate()}</span>
      </div>

      {isOpen && (
        <div style={{
          position: "absolute", top: "calc(100% + 10px)", right: 0, zIndex: 20000,
          backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 24,
          padding: 20, width: 300, boxShadow: "0 25px 60px rgba(0,0,0,0.8)", animation: "fadeIn 0.2s ease"
        }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <button onClick={prevMonth} style={{ padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 10, color: "#94a3b8", cursor: "pointer" }}>▶</button>
            <div style={{ color: "white", fontWeight: "bold", fontSize: "1rem", fontFamily: "'Tajawal', sans-serif" }}>{months[viewMonth]} {viewYear}</div>
            <button onClick={nextMonth} style={{ padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 10, color: "#94a3b8", cursor: "pointer" }}>◀</button>
          </div>

          {/* Days Week Labels */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5, marginBottom: 10 }}>
            {daysOfWeek.map(d => <div key={d} style={{ textAlign: "center", color: "#3b82f6", fontSize: "0.8rem", fontWeight: "bold" }}>{d}</div>)}
          </div>

          {/* Days Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 }}>
            {days.map((day, idx) => {
              if (day === null) return <div key={`empty-${idx}`} />;
              const dayStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const isToday = new Date().toISOString().split("T")[0] === dayStr;
              const isSelected = value === dayStr;

              return (
                <div
                  key={idx}
                  onClick={() => handleSelect(day)}
                  style={{
                    textAlign: "center", padding: "10px 0", borderRadius: 12, cursor: "pointer", fontSize: "0.9rem",
                    backgroundColor: isSelected ? "#3b82f6" : "transparent",
                    color: isSelected ? "white" : (isToday ? "#3b82f6" : "#cbd5e1"),
                    border: isToday && !isSelected ? "1px solid #3b82f6" : "none",
                    fontWeight: isSelected || isToday ? "bold" : "normal",
                    transition: "all 0.2s"
                  }}
                  onMouseEnter={e => !isSelected && (e.target.style.backgroundColor = "#0f172a")}
                  onMouseLeave={e => !isSelected && (e.target.style.backgroundColor = "transparent")}
                >
                  {day}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const APP_SOUNDS = [
  { id: "s1", name: "الجرس القياسي", url: getSoundPath("mixkit-access-allowed-tone-2869.wav") },
  { id: "s2", name: "تنبيه هادئ", url: getSoundPath("mixkit-bell-notification-933.wav") },
  { id: "s3", name: "فقاعة تنبيه", url: getSoundPath("mixkit-bubble-pop-up-alert-notification-2357.wav") },
  { id: "s4", name: "إعلان واضح", url: getSoundPath("mixkit-clear-announce-tones-2861.wav") },
  { id: "s5", name: "مكافأة نجاح", url: getSoundPath("mixkit-correct-answer-reward-952.wav") },
  { id: "s6", name: "نغمة صحيحة", url: getSoundPath("mixkit-correct-answer-tone-2870.wav") },
  { id: "s7", name: "جرس الباب", url: getSoundPath("mixkit-doorbell-single-press-333.wav") },
  { id: "s8", name: "إشعار سحري", url: getSoundPath("mixkit-fairy-message-notification-861.wav") },
  { id: "s9", name: "تنبيه جيتار", url: getSoundPath("mixkit-guitar-notification-alert-2320.wav") },
  { id: "s10", name: "أجراس سعيدة", url: getSoundPath("mixkit-happy-bells-notification-937.wav") },
  { id: "s11", name: "ماريمبا سحرية", url: getSoundPath("mixkit-magic-marimba-2820.wav") },
  { id: "s12", name: "رنين سحري", url: getSoundPath("mixkit-magic-notification-ring-2344.wav") },
  { id: "s13", name: "رنة ماريمبا", url: getSoundPath("mixkit-marimba-ringtone-1359.wav") },
  { id: "s14", name: "انتظار ماريمبا", url: getSoundPath("mixkit-marimba-waiting-ringtone-1360.wav") },
  { id: "s15", name: "موسيقى فلوت", url: getSoundPath("mixkit-melodical-flute-music-notification-2310.wav") },
  { id: "s16", name: "نغمة الانتظار", url: getSoundPath("mixkit-on-hold-ringtone-1361.wav") },
  { id: "s17", name: "إشعار إيجابي", url: getSoundPath("mixkit-positive-notification-951.wav") },
  { id: "s18", name: "تنبيه أركيد", url: getSoundPath("mixkit-repeating-arcade-beep-1084.wav") },
  { id: "s19", name: "إزالة واجهة", url: getSoundPath("mixkit-software-interface-remove-2576.wav") },
  { id: "s20", name: "بدء واجهة", url: getSoundPath("mixkit-software-interface-start-2574.wav") },
  { id: "s21", name: "رنة هاتف", url: getSoundPath("mixkit-toy-telephone-ring-1351.wav") },
  { id: "s22", name: "تنبيه عاجل", url: getSoundPath("mixkit-urgent-simple-tone-loop-2976.wav") },
  { id: "s23", name: "رنة انتظار", url: getSoundPath("mixkit-waiting-ringtone-1354.wav") },
  { id: "s24", name: "إشعار خطأ", url: getSoundPath("mixkit-wrong-answer-fail-notification-946.wav") }
];

// ══════════════════════════════════════════════════════════════════════════════
// صفحة تسجيل الدخول
// ══════════════════════════════════════════════════════════════════════════════
const LoginPage = ({ onLogin }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) { setError("يرجى إدخال اسم المستخدم وكلمة المرور"); return; }
    setLoading(true); setError("");
    try {
      const data = await login(username.trim(), password);
      reconnectSocket();
      onLogin(data.user);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const inputStyle = {
    width: "100%", backgroundColor: "#0f172a", border: "1px solid #334155",
    borderRadius: "14px", padding: "14px 18px", color: "white",
    fontSize: "1rem", outline: "none", boxSizing: "border-box",
    fontFamily: "inherit", transition: "border-color 0.25s",
  };
  const focus = (e) => (e.target.style.borderColor = "#3b82f6");
  const blur = (e) => (e.target.style.borderColor = "#334155");

  return (
    <FullScreenWrapper>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", minHeight: "100vh", padding: "20px", boxSizing: "border-box" }}>
        <div style={{ backgroundColor: "#1e293b", borderRadius: "35px", padding: "50px 40px", width: "100%", maxWidth: "420px", border: "1px solid #334155", boxShadow: "0 40px 80px rgba(0,0,0,0.5)" }}>

          <div style={{ textAlign: "center", marginBottom: "40px" }}>
            <div style={{ width: 100, height: 100, backgroundColor: "#1e293b", borderRadius: 30, display: "flex", justifyContent: "center", alignItems: "center", margin: "0 auto 20px", boxShadow: "0 20px 40px rgba(0,0,0,0.3)", border: "1px solid #334155", overflow: "hidden" }}>
              <img src={LOGO_PATH} alt="Logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }} />
              <Lock size={45} color="#3b82f6" style={{ display: "none" }} />
            </div>
            <h1 style={{ color: "white", margin: "0 0 6px", fontSize: "1.8rem", fontWeight: 900 }}>نظام النداء الذكي</h1>
            <p style={{ color: "#64748b", margin: 0, fontSize: "0.9rem" }}>سجّل دخولك للمتابعة</p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <label style={{ color: "#94a3b8", fontSize: "0.85rem", fontWeight: 600 }}>اسم المستخدم</label>
              <input id="login-username" type="text" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="أدخل اسم المستخدم..." dir="rtl" style={inputStyle} onFocus={focus} onBlur={blur} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <label style={{ color: "#94a3b8", fontSize: "0.85rem", fontWeight: 600 }}>كلمة المرور</label>
              <div style={{ position: "relative" }}>
                <input id="login-password" type={showPass ? "text" : "password"} value={password}
                  onChange={e => setPassword(e.target.value)} placeholder="أدخل كلمة المرور..." dir="rtl"
                  style={{ ...inputStyle, paddingLeft: 48 }} onFocus={focus} onBlur={blur} />
                <button type="button" onClick={() => setShowPass(p => !p)} style={{
                  position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center"
                }}>
                  {showPass ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>
            </div>

            {error && (
              <div style={{ backgroundColor: "#7f1d1d33", border: "1px solid #ef444455", borderRadius: 12, padding: "11px 15px", color: "#fca5a5", fontSize: "0.88rem", textAlign: "center" }}>
                ⚠️ {error}
              </div>
            )}

            <button id="login-submit" type="submit" disabled={loading} style={{
              backgroundColor: loading ? "#1d4ed8" : "#3b82f6", color: "white", border: "none",
              borderRadius: 14, padding: 16, fontSize: "1.05rem", fontWeight: "bold",
              cursor: loading ? "not-allowed" : "pointer", transition: "all 0.25s", marginTop: 6,
              boxShadow: "0 8px 25px rgba(59,130,246,0.35)", fontFamily: "inherit",
            }}>
              {loading ? "جاري تسجيل الدخول..." : "تسجيل الدخول 🔐"}
            </button>
          </form>


        </div>
      </div>
    </FullScreenWrapper>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// نافذة تغيير كلمة المرور
// ══════════════════════════════════════════════════════════════════════════════
const ChangePasswordModal = ({ onClose, onSuccess }) => {
  const [current, setCurrent] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (newPass !== confirm) { setError("كلمة المرور الجديدة غير متطابقة"); return; }
    if (newPass.length < 6) { setError("كلمة المرور يجب أن تكون 6 أحرف على الأقل"); return; }
    setLoading(true); setError("");
    try { await changePassword(current, newPass); onSuccess("تم تغيير كلمة المرور بنجاح ✅"); onClose(); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const fi = { backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: 12, padding: "11px 14px", color: "white", fontSize: "0.9rem", outline: "none", fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(2,6,23,0.95)", zIndex: 20000, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "80px 15px 20px", overflowY: "auto" }}>
      <div style={{ backgroundColor: "#1e293b", width: "100%", maxWidth: 400, borderRadius: 28, padding: 30, border: "1px solid #334155", boxShadow: "0 30px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <KeyRound size={20} color="#3b82f6" />
            <h2 style={{ color: "white", margin: 0, fontSize: "1.15rem" }}>تغيير كلمة المرور</h2>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          {[["كلمة المرور الحالية", current, setCurrent], ["كلمة المرور الجديدة", newPass, setNewPass], ["تأكيد كلمة المرور", confirm, setConfirm]].map(([label, val, set]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ color: "#94a3b8", fontSize: "0.82rem", fontWeight: 600 }}>{label}</label>
              <input type="password" value={val} onChange={e => set(e.target.value)} dir="rtl" style={fi} />
            </div>
          ))}
          {error && <div style={{ backgroundColor: "#7f1d1d33", border: "1px solid #ef444455", borderRadius: 10, padding: "9px 13px", color: "#fca5a5", fontSize: "0.85rem", textAlign: "center" }}>⚠️ {error}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 5 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: 12, borderRadius: 12, background: "#334155", color: "white", border: "none", cursor: "pointer", fontFamily: "inherit" }}>إلغاء</button>
            <button type="submit" disabled={loading} style={{ flex: 1, padding: 12, borderRadius: 12, background: "#3b82f6", color: "white", border: "none", cursor: "pointer", fontWeight: "bold", fontFamily: "inherit" }}>
              {loading ? "جاري التغيير..." : "تغيير"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// شريط علوي مشترك
// ══════════════════════════════════════════════════════════════════════════════
const TopBar = ({ user, onLogout, onChangePassword, connected }) => {
  const isMobile = useIsMobile();
  const roleLabel = {
    manager: "المدير العام",
    secretary: "السكرتارية",
    kitchen: "المطبخ",
    "office-manager": "مدير المكتب",
    "deputy-tech": "معاون المدير العام الفني",
    "office-tech": "إدارة مكتب المعاون الفني",
    "deputy-admin": "معاون المدير العام الإداري والمالي",
    "office-admin": "إدارة مكتب المعاون الإداري والمالي"
  };
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000,
      backgroundColor: "#0f172acc", backdropFilter: "blur(16px)",
      borderBottom: "1px solid #1e293b", padding: isMobile ? "12px 14px" : "12px 20px",
      display: "flex", justifyContent: "space-between", alignItems: "center",
      flexDirection: isMobile ? "column" : "row", gap: isMobile ? 12 : 0
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: isMobile ? "space-between" : "flex-start", width: isMobile ? "100%" : "auto", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={LOGO_PATH} alt="Logo" style={{ height: 32, width: 32, objectFit: "contain" }} />
          <ConnectionBadge connected={connected} />
        </div>
        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "flex-end" : "center", gap: isMobile ? 2 : 5 }}>
          { }
          <span style={{ color: "white", fontWeight: 600, fontSize: "0.85rem" }}>{user?.username}</span>
          {!isMobile && <span style={{ color: "#94a3b8" }}>·</span>}
          <span style={{ color: "#3b82f6", fontSize: isMobile ? "0.75rem" : "0.85rem" }}>
            {user?.role === "department" ? (window.app_sections_cache?.[user?.room_id] || "قسم / مديرية") : (roleLabel[user?.role] || user?.role)}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, width: isMobile ? "100%" : "auto", justifyContent: isMobile ? "space-between" : "flex-start" }}>
        <button onClick={onChangePassword} style={{ flex: isMobile ? 1 : "none", justifyContent: "center", background: "#1e293b", border: "1px solid #334155", borderRadius: 9, padding: "8px 12px", color: "#94a3b8", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: "0.8rem", whiteSpace: "nowrap" }}>
          <KeyRound size={14} /> تغيير رمز المرور
        </button>
        <button onClick={onLogout} style={{ flex: isMobile ? 1 : "none", justifyContent: "center", background: "#7f1d1d33", border: "1px solid #ef444433", borderRadius: 9, padding: "8px 12px", color: "#f87171", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: "0.8rem", whiteSpace: "nowrap" }}>
          <LogOut size={14} /> تسجيل خروج
        </button>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// لوحة سجل الطلبات (للمدير أو للقسم)
// ══════════════════════════════════════════════════════════════════════════════
const LogsPanel = ({ onClose, roomId = null, initialTab = "logs" }) => {
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(initialTab); // "logs" | "stats"
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  const load = useCallback(async (isInitial = true) => {
    if (isInitial) {
      setLoading(true);
      setPage(1);
      setHasMore(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const currentPage = isInitial ? 1 : page + 1;
      const limit = 50;
      const offset = (currentPage - 1) * limit;

      const queryParams = new URLSearchParams();
      if (searchQuery) queryParams.append("search", searchQuery);
      if (dateFilter) queryParams.append("date", dateFilter);
      queryParams.append("limit", limit);
      queryParams.append("offset", offset);
      const qs = queryParams.toString();

      if (roomId) {
        const lr = await authFetch(`/api/logs/room/${roomId}?${qs}`);
        const ld = await lr.json();
        const newLogs = ld.logs || [];
        setLogs(prev => isInitial ? newLogs : [...prev, ...newLogs]);
        setHasMore(newLogs.length === limit);
      } else {
        const statsReq = isInitial ? authFetch("/api/stats") : Promise.resolve(null);
        const [lr, sr] = await Promise.all([
          authFetch(`/api/logs?${qs}`),
          statsReq
        ]);
        const ld = await lr.json();
        const newLogs = ld.logs || [];
        setLogs(prev => isInitial ? newLogs : [...prev, ...newLogs]);
        setHasMore(newLogs.length === limit);

        if (sr) {
          const sd = await sr.json();
          if (sd) setStats(sd);
        }
      }
      if (!isInitial) setPage(currentPage);
    } catch (err) {
      console.error("Error loading logs:", err);
    }
    setLoading(false);
    setLoadingMore(false);
  }, [roomId, searchQuery, dateFilter, page]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(true); }, [roomId, searchQuery, dateFilter]); // Only reload on filter change


  const handleScroll = (e) => {
    if (tab !== "logs" || loading || loadingMore || !hasMore) return;
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 50) {
      load(false);
    }
  };

  const clearLogs = async () => {
    const msg = dateFilter
      ? `هل أنت متأكد من حذف سجلات تاريخ ${dateFilter}؟`
      : "هل أنت متأكد من حذف جميع السجلات؟ سيتم مسح الملفات الصوتية أيضاً.";
    if (!confirm(msg)) return;

    const url = dateFilter ? `/api/logs?date=${dateFilter}` : "/api/logs";
    const res = await authFetch(url, { method: "DELETE" });
    if (res.ok) {
      load(true);
    }
  };

  const fmt = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString("ar-EG", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(2,6,23,0.96)", zIndex: 15000, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "70px 15px 20px", overflowY: "auto" }}>
      <div style={{ backgroundColor: "#1e293b", width: "100%", maxWidth: 800, borderRadius: 28, border: "1px solid #334155", boxShadow: "0 30px 70px rgba(0,0,0,0.6)" }}>

        {/* Header */}
        <div style={{ padding: "22px 26px", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <History size={22} color="#3b82f6" />
            <h2 style={{ color: "white", margin: 0, fontSize: "1.2rem" }}>سجل الطلبات {roomId ? "الخاص بالقسم" : ""}</h2>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={load} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 9, padding: "7px 12px", color: "#94a3b8", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: "0.8rem" }}>
              <RefreshCw size={13} /> تحديث
            </button>
            {!roomId && (
              <button onClick={clearLogs} style={{ background: "#7f1d1d33", border: "1px solid #ef444433", borderRadius: 9, padding: "7px 12px", color: "#f87171", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: "0.8rem" }}>
                <Trash size={13} /> حذف الكل
              </button>
            )}
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}><X size={22} /></button>
          </div>
        </div>

        {/* Tabs */}
        {!roomId && (
          <div style={{ display: "flex", gap: 4, padding: "14px 22px", borderBottom: "1px solid #1e293b" }}>
            {[["logs", "السجل", "📋"], ["stats", "الإحصائيات", "📊"]].map(([t, label, ico]) => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: "8px 18px", borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 600,
                backgroundColor: tab === t ? "#3b82f6" : "#0f172a", color: tab === t ? "white" : "#64748b",
                fontSize: "0.88rem", fontFamily: "inherit", transition: "all 0.2s",
              }}>
                {ico} {label}
              </button>
            ))}
          </div>
        )}

        {/* Search Bar */}
        {tab === "logs" && (
          <div style={{ padding: "15px 22px", backgroundColor: "#0f172a", borderBottom: "1px solid #1e293b", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <input
                type="text"
                placeholder="🔍 بحث عن كلمة..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') load() }}
                style={{ width: "100%", height: 45, padding: "0 14px", borderRadius: 12, border: "1px solid #334155", backgroundColor: "#1e293b", color: "white", fontFamily: "inherit", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ width: 160 }}>
              <CustomDatePicker
                value={dateFilter}
                onChange={setDateFilter}
                style={{ height: 45 }}
              />
            </div>
            <button onClick={load} style={{ height: 45, width: 80, backgroundColor: "#3b82f6", color: "white", border: "none", borderRadius: 12, padding: 0, cursor: "pointer", fontWeight: "bold", fontFamily: "inherit", whiteSpace: "nowrap" }}>
              بحث
            </button>
            {(searchQuery || dateFilter) && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setDateFilter("");
                }}
                style={{ height: 45, backgroundColor: "#7f1d1d33", color: "#f87171", border: "1px solid #ef444433", borderRadius: 12, padding: "0 15px", cursor: "pointer", fontWeight: "bold", fontFamily: "inherit", whiteSpace: "nowrap" }}
              >
                إلغاء التصفية
              </button>
            )}
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{ padding: 22, maxHeight: "65vh", overflowY: "auto" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#475569" }}>
              <RefreshCw size={30} style={{ animation: "spin 1s linear infinite", marginBottom: 12 }} />
              <p>جاري التحميل...</p>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          ) : tab === "stats" && stats ? (
            // ─── الإحصائيات ──────────────────────────────────────────────────
            <div>
              {/* بطاقات الإحصاء */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 14, marginBottom: 24 }}>
                {[
                  { label: "إجمالي الطلبات", value: stats.total, color: "#3b82f6", icon: "📨" },
                  { label: "طلبات اليوم", value: stats.today, color: "#a855f7", icon: "📅" },
                  { label: "في الانتظار", value: stats.pending, color: "#f59e0b", icon: "⏳" },
                  { label: "مكتملة", value: stats.completed, color: "#22c55e", icon: "✅" },
                ].map(s => (
                  <div key={s.label} style={{ backgroundColor: "#0f172a", borderRadius: 16, padding: "18px 16px", border: `1px solid ${s.color}33`, textAlign: "center" }}>
                    <div style={{ fontSize: "1.8rem", marginBottom: 6 }}>{s.icon}</div>
                    <div style={{ fontSize: "2rem", fontWeight: 900, color: s.color }}>{s.value}</div>
                    <div style={{ color: "#64748b", fontSize: "0.78rem", marginTop: 4 }}>{s.label}</div>
                  </div>
                ))}
              </div>
              {/* توزيع الأقسام */}
              <h3 style={{ color: "#94a3b8", fontSize: "0.9rem", marginBottom: 12 }}>الطلبات لكل قسم</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {stats.bySection.map(bs => (
                  <div key={bs.to_section_title} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ color: "white", minWidth: 140, fontSize: "0.9rem" }}>{bs.to_section_title || "غير محدد"}</span>
                    <div style={{ flex: 1, height: 10, backgroundColor: "#0f172a", borderRadius: 6, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${stats.total ? Math.round(bs.count / stats.total * 100) : 0}%`, backgroundColor: "#3b82f6", borderRadius: 6, transition: "width 0.6s ease" }} />
                    </div>
                    <span style={{ color: "#3b82f6", fontWeight: 700, minWidth: 28, textAlign: "right" }}>{bs.count}</span>
                  </div>
                ))}
                {stats.bySection.length === 0 && <p style={{ color: "#475569", textAlign: "center" }}>لا توجد بيانات بعد</p>}
              </div>
            </div>
          ) : (
            // ─── السجل ───────────────────────────────────────────────────────
            <div>
              {logs.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 20px" }}>
                  <History size={60} style={{ opacity: 0.1, marginBottom: 16 }} color="white" />
                  <p style={{ color: "#475569" }}>لا توجد سجلات حتى الآن</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {logs.map(log => (
                    <div key={log.id} style={{
                      backgroundColor: "#0f172a", borderRadius: 16, padding: "14px 18px",
                      border: "1px solid #1e293b", display: "flex", flexDirection: "column", gap: 8,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: log.audio ? 10 : 0 }}>
                          <span style={{ color: "white", fontWeight: 700, fontSize: "1rem" }}>{log.message}</span>
                          <span style={{ color: "#475569", fontSize: "0.8rem" }}>← {log.to_section_title || `غرفة ${log.to_room_id}`}</span>
                        </div>
                        <StatusBadge status={log.status} />
                      </div>
                      {log.audio && (
                        <audio
                          src={log.audio.startsWith('data:') ? log.audio : `${SERVER_URL}${log.audio}${log.audio.includes('?') ? '&' : '?'}token=${getToken()}`}
                          controls
                          style={{ width: "100%", height: 35, marginBottom: 8 }}
                        />
                      )}
                      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                        <span style={{ color: "#64748b", fontSize: "0.75rem" }}>📨 {fmt(log.sent_at)}</span>
                        {log.received_at && <span style={{ color: "#3b82f6", fontSize: "0.75rem" }}>👁 {fmt(log.received_at)}</span>}
                        {log.completed_at && <span style={{ color: "#22c55e", fontSize: "0.75rem" }}>✅ {fmt(log.completed_at)}</span>}
                      </div>
                    </div>
                  ))}
                  {loadingMore && (
                    <div style={{ textAlign: "center", padding: "15px", color: "#3b82f6" }}>
                      <RefreshCw size={20} style={{ animation: "spin 1s linear infinite" }} />
                    </div>
                  )}
                  {!hasMore && logs.length > 0 && (
                    <p style={{ textAlign: "center", color: "#475569", fontSize: "0.8rem", marginTop: 10 }}>— نهاية السجل —</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// لوحة جدول الأعمال (للمدير والسكرتارية)
// ══════════════════════════════════════════════════════════════════════════════
const AgendaPanel = ({ onClose, user }) => {
  const [items, setItems] = useState([]);
  const [selectedDate, setSelectedDate] = useState(getLocalDate());
  const [newTask, setNewTask] = useState("");
  const [newTime, setNewTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editTask, setEditTask] = useState("");
  const [editTime, setEditTime] = useState("");
  const [draggedIdx, setDraggedIdx] = useState(null);

  // Export states
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportStart, setExportStart] = useState(getLocalDate());
  const [exportEnd, setExportEnd] = useState(getLocalDate());
  const [exporting, setExporting] = useState(false);

  const isSecretary = user.role === "secretary";

  const loadAgenda = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/agenda/${selectedDate}`);
      if (res.ok) setItems(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [selectedDate]);

  useEffect(() => {
    loadAgenda();
    const handleRefresh = (updatedDate) => {
      if (updatedDate === selectedDate) loadAgenda();
    };
    socket.on("refresh-agenda", handleRefresh);
    return () => socket.off("refresh-agenda", handleRefresh);
  }, [loadAgenda, selectedDate]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newTask.trim() || !newTime) return;
    try {
      const res = await authFetch("/api/agenda", {
        method: "POST",
        body: JSON.stringify({ date: selectedDate, time: newTime, task: newTask })
      });
      if (res.ok) {
        setNewTask(""); setNewTime("");
        socket.emit("agenda-updated", selectedDate);
        loadAgenda();
      }
    } catch { /* ignore */ }
  };

  const handleToggle = async (id, currentStatus) => {
    try {
      await authFetch(`/api/agenda/${id}`, {
        method: "PUT",
        body: JSON.stringify({ is_done: !currentStatus })
      });
      socket.emit("agenda-updated", selectedDate);
      loadAgenda();
    } catch { /* ignore */ }
  };

  const handleCancelToggle = async (id, currentCancelled) => {
    try {
      await authFetch(`/api/agenda/${id}`, {
        method: "PUT",
        body: JSON.stringify({ is_cancelled: !currentCancelled })
      });
      socket.emit("agenda-updated", selectedDate);
      loadAgenda();
    } catch { /* ignore */ }
  };

  const handleDelete = async (id) => {
    if (!confirm("هل أنت متأكد من الحذف؟")) return;
    try {
      await authFetch(`/api/agenda/${id}`, { method: "DELETE" });
      socket.emit("agenda-updated", selectedDate);
      loadAgenda();
    } catch { /* ignore */ }
  };

  const handleSaveEdit = async (id) => {
    if (!editTask.trim() || !editTime) return;
    try {
      await authFetch(`/api/agenda/${id}`, {
        method: "PUT",
        body: JSON.stringify({ task: editTask, time: editTime })
      });
      setEditingId(null);
      socket.emit("agenda-updated", selectedDate);
      loadAgenda();
    } catch { /* ignore */ }
  };

  const handleDragStart = (e, index) => {
    setDraggedIdx(index);
  };

  const handleDragEnter = (e, targetIdx) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === targetIdx) return;

    const actualItems = [...items];
    const itemToMove = actualItems[draggedIdx];
    actualItems.splice(draggedIdx, 1);
    actualItems.splice(targetIdx, 0, itemToMove);

    setDraggedIdx(targetIdx);
    setItems(actualItems);
  };

  const handleDragEnd = async () => {
    if (draggedIdx === null) return;
    setDraggedIdx(null);
    if (!isSecretary) return;

    try {
      const orderedIds = items.map(i => i.id);
      await authFetch("/api/agenda/reorder", {
        method: "PUT",
        body: JSON.stringify({ orderedIds })
      });
      socket.emit("agenda-updated", selectedDate);
    } catch { /* ignore */ }
  };

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const res = await authFetch(`/api/agenda/range?start=${exportStart}&end=${exportEnd}`);
      if (!res.ok) throw new Error();
      const data = await res.json();

      const grouped = data.reduce((acc, item) => {
        if (!acc[item.date]) acc[item.date] = [];
        acc[item.date].push(item);
        return acc;
      }, {});

      const dates = Object.keys(grouped).sort();
      const printWindow = window.open('', '_blank');
      let html = `
        <html dir="rtl">
        <head>
          <title>جدول اعمال المدير العام - ${exportStart} إلى ${exportEnd}</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; color: #1e293b; max-width: 900px; margin: auto; }
            .header-container { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #1e3a8a; padding-bottom: 20px; margin-bottom: 30px; }
            .header-text { flex: 1; text-align: center; }
            .header-text h2 { margin: 0; color: #1e3a8a; font-size: 1.6rem; }
            .header-text h1 { margin: 5px 0 0; color: #0f172a; font-size: 2.2rem; }
            .logo { width: 120px; height: auto; object-fit: contain; }
            .subtitle { text-align: center; color: #64748b; margin-bottom: 40px; font-size: 1.1rem; font-weight: bold; }
            .date-section { margin-bottom: 35px; border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; break-inside: avoid; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
            .date-title { font-size: 1.3rem; color: #fff; background-color: #3b82f6; margin: 0; padding: 12px 20px; }
            table { width: 100%; border-collapse: collapse; background: #fff; }
            th, td { padding: 12px 20px; border-bottom: 1px solid #e2e8f0; text-align: right; }
            th { background-color: #f8fafc; color: #475569; font-weight: bold; border-bottom: 2px solid #cbd5e1; }
            tr:last-child td { border-bottom: none; }
            .done { color: #16a34a; font-weight: bold; }
            .cancelled { color: #dc2626; text-decoration: line-through; }
            .pending { color: #f59e0b; }
          </style>
        </head>
        <body>
          <div class="header-container">
            <!-- الشعار يوضع في مجلد public باسم logo.png -->
            <img src="/logo.png" class="logo" alt="الشركة العامة لموانئ العراق" onerror="this.style.display='none'" />
            <div class="header-text">
              <h2>الشركة العامة لموانئ العراق</h2>
              <h1>جدول اعمال المدير العام</h1>
            </div>
            <div style="width: 120px;"></div> <!-- توازن في التصميم -->
          </div>
          <div class="subtitle">الفترة من: <span dir="ltr">${exportStart}</span> إلى: <span dir="ltr">${exportEnd}</span></div>
      `;

      if (dates.length === 0) {
        html += `<p style="text-align:center; font-size:1.2rem; margin-top: 50px;">لا توجد أحداث مسجلة في هذه الفترة.</p>`;
      } else {
        dates.forEach(d => {
          html += `<div class="date-section">
            <h2 class="date-title">📅 تاريخ: ${d}</h2>
            <table>
              <tr><th style="width:15%">الوقت</th><th style="width:65%">الحدث / المهمة</th><th style="width:20%">الإنجاز</th></tr>`;
          grouped[d].forEach(it => {
            let status = it.is_cancelled ? `<span class="cancelled">ملغاة</span>` : (it.is_done ? `<span class="done">تم الإنجاز ✔️</span>` : `<span class="pending">قيد الانتظار</span>`);
            html += `<tr>
              <td style="font-weight:bold; color:#475569;">${it.time}</td>
              <td style="${it.is_cancelled ? 'text-decoration:line-through; color:#94a3b8;' : 'font-size:1.05rem;'}">${it.task}</td>
              <td>${status}</td>
            </tr>`;
          });
          html += `</table></div>`;
        });
      }

      html += `
        <div style="margin-top:50px; text-align:center; font-size:0.9rem; color:#94a3b8; border-top: 1px solid #e2e8f0; padding-top: 20px;">
          تم إصدار هذا المستند عبر نظام الاتصال الذكي بتاريخ ${new Date().toLocaleString('ar-EG')}
        </div>
        <script>
          window.onload = function() { window.print(); window.setTimeout(function(){ window.close(); }, 1000); };
        </script>
        </body></html>
      `;

      printWindow.document.write(html);
      printWindow.document.close();
      setShowExportModal(false);
    } catch { /* ignore */
      alert("حدث خطأ أثناء التصدير للـ PDF");
    }

    setExporting(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(2,6,23,0.96)", zIndex: 15000, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "70px 15px 20px", overflowY: "auto" }} dir="rtl">
      <div style={{ backgroundColor: "#1e293b", width: "100%", maxWidth: 660, borderRadius: 28, border: "1px solid #334155", boxShadow: "0 30px 70px rgba(0,0,0,0.6)" }}>
        <div style={{ padding: "22px 26px", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Calendar size={22} color="#a855f7" />
            <h2 style={{ color: "white", margin: 0, fontSize: "1.2rem" }}>جدول أعمال المدير</h2>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setShowExportModal(true)} style={{ background: "#1e3a8a", border: "1px solid #3b82f6", borderRadius: 9, padding: "7px 12px", color: "#bfdbfe", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: "0.85rem", fontWeight: "bold", fontFamily: "inherit" }}>
              📄 تصدير PDF
            </button>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}><X size={22} /></button>
          </div>
        </div>

        {showExportModal && (
          <div style={{ padding: "20px 25px", borderBottom: "1px solid #334155", backgroundColor: "#0f172a", borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
            <h3 style={{ margin: "0 0 15px 0", color: "#60a5fa", fontSize: "1.05rem" }}>تصدير جدول الأعمال (PDF)</h3>
            <div style={{ display: "flex", gap: 15, flexWrap: "wrap", alignItems: "flex-end", width: "100%" }}>
              <CustomDatePicker
                label="من تاريخ:"
                value={exportStart}
                onChange={setExportStart}
              />
              <CustomDatePicker
                label="إلى تاريخ:"
                value={exportEnd}
                onChange={setExportEnd}
              />
              <button onClick={handleExportPDF} disabled={exporting} style={{ backgroundColor: "#3b82f6", color: "white", border: "none", borderRadius: 14, padding: "10px 25px", cursor: exporting ? "not-allowed" : "pointer", fontWeight: "bold", fontFamily: "inherit", height: 46 }}>
                {exporting ? "جاري التحضير..." : "طباعة / حفظ 🖨️"}
              </button>
            </div>
          </div>
        )}

        <div style={{ padding: 22 }}>
          <div style={{ marginBottom: 25, display: "flex", gap: 10, maxWidth: 200 }}>
            <CustomDatePicker value={selectedDate} onChange={setSelectedDate} />
          </div>

          {isSecretary && (
            <form onSubmit={handleAdd} style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", backgroundColor: "#0f172a", padding: 15, borderRadius: 16 }}>
              <input type="time" required value={newTime} onChange={e => setNewTime(e.target.value)} style={{ padding: 10, borderRadius: 10, border: "1px solid #334155", backgroundColor: "#1e293b", color: "white", fontFamily: "inherit" }} />
              <input type="text" placeholder="الحدث أو الموعد..." required value={newTask} onChange={e => setNewTask(e.target.value)} style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid #334155", backgroundColor: "#1e293b", color: "white", fontFamily: "inherit", minWidth: 200 }} />
              <button type="submit" style={{ backgroundColor: "#a855f7", color: "white", border: "none", borderRadius: 10, padding: "10px 15px", cursor: "pointer", fontWeight: "bold", fontFamily: "inherit" }}>إضافة ➕</button>
            </form>
          )}

          {loading ? (
            <div style={{ textAlign: "center", padding: "30px 0", color: "#475569" }}>جاري التحميل...</div>
          ) : items.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#475569" }}>لا يوجد جدول أعمال لهذا اليوم</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {items.map((it, idx) => (
                <div
                  key={it.id}
                  draggable={isSecretary && editingId !== it.id}
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragEnter={(e) => handleDragEnter(e, idx)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => e.preventDefault()}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    flexWrap: "wrap", gap: 10,
                    backgroundColor: it.is_cancelled ? "#7f1d1d33" : (it.is_done ? "#14532d33" : "#0f172a"),
                    border: `1px solid ${it.is_cancelled ? '#ef444444' : (it.is_done ? '#22c55e44' : '#334155')}`,
                    padding: "12px 18px", borderRadius: 14,
                    opacity: draggedIdx === idx ? 0.3 : (it.is_done || it.is_cancelled ? 0.7 : 1),
                    cursor: isSecretary && editingId !== it.id ? "grab" : "default",
                    transition: "transform 0.2s, opacity 0.2s"
                  }}
                >
                  {editingId === it.id ? (
                    <div style={{ display: "flex", gap: 10, width: "100%", flexWrap: "wrap", alignItems: "center" }}>
                      <input type="time" value={editTime} onChange={e => setEditTime(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #3b82f6", backgroundColor: "#1e293b", color: "white", fontFamily: "inherit" }} />
                      <input type="text" value={editTask} onChange={e => setEditTask(e.target.value)} style={{ flex: 1, padding: "8px 12px", minWidth: 150, borderRadius: 8, border: "1px solid #3b82f6", backgroundColor: "#1e293b", color: "white", fontFamily: "inherit" }} />
                      <button onClick={() => handleSaveEdit(it.id)} style={{ backgroundColor: "#22c55e", color: "white", border: "none", borderRadius: 8, padding: "8px 15px", cursor: "pointer", fontWeight: "bold", fontFamily: "inherit" }}>حفظ</button>
                      <button onClick={() => setEditingId(null)} style={{ backgroundColor: "#475569", color: "white", border: "none", borderRadius: 8, padding: "8px 15px", cursor: "pointer", fontFamily: "inherit" }}>إلغاء</button>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: "#64748b", opacity: isSecretary ? 0.6 : 0, cursor: isSecretary ? "grab" : "default" }}>
                          {/* أيقونة سحب خفيفة */}
                          <div style={{ height: 2, width: 14, backgroundColor: "currentColor", marginBottom: 3, borderRadius: 2 }} />
                          <div style={{ height: 2, width: 14, backgroundColor: "currentColor", marginBottom: 3, borderRadius: 2 }} />
                          <div style={{ height: 2, width: 14, backgroundColor: "currentColor", borderRadius: 2 }} />
                        </div>
                        <span style={{ color: it.is_cancelled ? "#ef4444" : "#a855f7", fontWeight: "bold", fontSize: "1.2rem", marginLeft: 5 }}>{it.time}</span>
                        <span style={{ color: it.is_cancelled ? "#f87171" : "white", fontSize: "1.05rem", textDecoration: it.is_done || it.is_cancelled ? "line-through" : "none" }}>{it.task} {it.is_cancelled ? "(ملغاة)" : null}</span>
                      </div>
                      <div style={{ display: "flex", gap: 10 }}>
                        {isSecretary && !it.is_done && !it.is_cancelled && (
                          <button onClick={() => { setEditingId(it.id); setEditTask(it.task); setEditTime(it.time); }} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#3b82f6", padding: "5px 10px", display: "flex", alignItems: "center", gap: 5, backgroundColor: "#1e3a8a33", borderRadius: 8, fontSize: "0.85rem" }}>
                            ✏️ تعديل
                          </button>
                        )}
                        {isSecretary && !it.is_done && (
                          <button onClick={() => handleCancelToggle(it.id, it.is_cancelled)} style={{ background: "transparent", border: "none", cursor: "pointer", color: it.is_cancelled ? "#f59e0b" : "#ef4444", padding: "5px 10px", display: "flex", alignItems: "center", gap: 5, backgroundColor: it.is_cancelled ? "#78350f44" : "#7f1d1d33", borderRadius: 8, fontSize: "0.85rem" }}>
                            {it.is_cancelled ? "↩️ تفعيل" : "🚫 إلغاء"}
                          </button>
                        )}
                        {!it.is_cancelled && (
                          <button onClick={() => handleToggle(it.id, it.is_done)} style={{ background: "transparent", border: "none", cursor: "pointer", color: it.is_done ? "#22c55e" : "#64748b", display: "flex", alignItems: "center", gap: 5, fontSize: "0.85rem", padding: "5px 10px", backgroundColor: "#1e293b", borderRadius: 8 }}>
                            <CheckCircle2 size={16} /> {it.is_done ? "منجز" : "إنجاز"}
                          </button>
                        )}
                        {isSecretary && (
                          <button onClick={() => handleDelete(it.id)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#ef4444", padding: "6px", display: "flex", alignItems: "center", backgroundColor: "#7f1d1d33", borderRadius: 8 }}>
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// لوحة إدارة الملفات والمستندات المهمة
// ══════════════════════════════════════════════════════════════════════════════
const FilesPanel = ({ onClose, user, showToast }) => {
  const isMobile = useIsMobile();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState(null);
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("عام");
  const [filterCategory, setFilterCategory] = useState("الكل");
  const [categories, setCategories] = useState([]);
  const [showManageCats, setShowManageCats] = useState(false);
  const [newCat, setNewCat] = useState("");

  const fetchCats = async () => {
    try {
      const res = await authFetch("/api/categories");
      if (res.ok) setCategories(await res.json());
    } catch { /* ignore */ }
  };

  const fetchFiles = async (q = search, cat = filterCategory) => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/files?search=${q}&category=${cat}`);
      if (res.ok) setFiles(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    fetchFiles(search, filterCategory);
    fetchCats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCategory]);


  const handleUpload = (e) => {
    e.preventDefault();
    if (!selectedFile) return alert("يرجى اختيار ملف أولاً");

    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("title", title || selectedFile.name);
    formData.append("category", category);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SERVER_URL}/api/files/upload`);
    xhr.setRequestHeader("Authorization", `Bearer ${getToken()}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percent);
      }
    };

    xhr.onload = () => {
      setUploading(false);
      setUploadProgress(0);
      let data;
      try { data = JSON.parse(xhr.responseText); } catch { data = { error: "رد غير صالح من السيرفر" }; }

      if (xhr.status >= 200 && xhr.status < 300) {
        setTitle("");
        setSelectedFile(null);
        setCategory("عام");
        fetchFiles(search, filterCategory);
        showToast("تم رفع الملف بنجاح ✅", "success");
      } else {
        alert(data.error || "فشل رفع الملف");
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setUploadProgress(0);
      alert("خطأ في الاتصال بالسيرفر");
    };

    xhr.send(formData);
  };

  const addCat = async () => {
    if (!newCat.trim()) return;
    try {
      const res = await authFetch("/api/categories", { method: "POST", body: JSON.stringify({ name: newCat }) });
      if (res.ok) { setNewCat(""); fetchCats(); }
    } catch { /* ignore */ }
  };

  const delCat = async (name) => {
    if (!confirm("هل أنت متأكد من حذف هذا التصنيف؟")) return;
    try {
      const res = await authFetch(`/api/categories/${name}`, { method: "DELETE" });
      if (res.ok) fetchCats();
    } catch { /* ignore */ }
  };

  const deleteFile = async (id) => {
    if (!confirm("هل أنت متأكد من حذف هذا الملف؟")) return;
    try {
      const res = await authFetch(`/api/files/${id}`, { method: "DELETE" });
      if (res.ok) fetchFiles(search, filterCategory);
    } catch { /* ignore */ }
  };

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(2,6,23,0.96)", zIndex: 12000, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "70px 15px 20px", overflowY: "auto" }} dir="rtl">
      <div style={{ backgroundColor: "#1e293b", width: "100%", maxWidth: 850, borderRadius: 28, border: "1px solid #334155", boxShadow: "0 40px 100px rgba(0,0,0,0.7)" }}>

        {/* Header */}
        <div style={{ padding: "24px 30px", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <FileText size={28} color="#3b82f6" />
            <h2 style={{ color: "white", margin: 0, fontSize: "1.4rem" }}>المستندات والملفات المهمة</h2>
          </div>
          <div style={{ display: "flex", gap: 15, alignItems: "center" }}>
            {user.role === 'secretary' && (
              <button onClick={() => setShowManageCats(!showManageCats)} style={{ background: "none", border: "1px solid #334155", padding: "6px 12px", borderRadius: 10, color: "#94a3b8", cursor: "pointer", fontSize: "0.85rem" }}>
                {showManageCats ? "إغلاق التصنيفات" : "إدارة التصنيفات"}
              </button>
            )}
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}><X size={26} /></button>
          </div>
        </div>

        <div style={{ padding: 30 }}>
          {/* Search and Upload Section */}
          <div style={{ display: "flex", flexDirection: "column", gap: 25, marginBottom: 35 }}>

            {/* شريط البحث وفلتر التصنيف */}
            <div style={{ display: "flex", gap: 15, flexWrap: "wrap" }}>
              <div style={{ position: "relative", flex: 2, minWidth: "250px" }}>
                <Search style={{ position: "absolute", right: 15, top: "50%", transform: "translateY(-50%)", color: "#64748b" }} size={20} />
                <input
                  type="text"
                  placeholder="ابحث عن ملف بالعنوان..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); fetchFiles(e.target.value, filterCategory); }}
                  style={{ width: "100%", padding: "14px 45px 14px 15px", borderRadius: 16, border: "1px solid #334155", backgroundColor: "#0f172a", color: "white", fontSize: "1rem", outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ flex: 1, minWidth: "150px" }}>
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  style={{ width: "100%", padding: "14px", borderRadius: 16, border: "1px solid #334155", backgroundColor: "#0f172a", color: "white", fontSize: "1rem", outline: "none", cursor: "pointer" }}
                >
                  <option value="الكل">جميع التصنيفات</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {/* إدارة التصنيفات */}
            {showManageCats && (
              <div style={{ backgroundColor: "#0f172a", padding: 20, borderRadius: 20, border: "1px solid #334155", animation: "slideIn 0.3s ease" }}>
                <style>{`@keyframes slideIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}`}</style>
                <h3 style={{ color: "white", fontSize: "1rem", marginTop: 0, marginBottom: 15 }}>إدارة تصنيفات الملفات</h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 15 }}>
                  {categories.map(c => (
                    <div key={c} style={{ backgroundColor: "#1e293b", color: "#cbd5e1", padding: "6px 12px", borderRadius: 8, display: "flex", alignItems: "center", gap: 8, border: "1px solid #334155" }}>
                      {c}
                      <Trash2 size={14} color="#ef4444" style={{ cursor: "pointer" }} onClick={() => delCat(c)} />
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <input type="text" value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="اسم التصنيف الجديد..." style={{ flex: 1, backgroundColor: "#1e293b", border: "1px solid #334155", color: "white", padding: 10, borderRadius: 10, fontFamily: "inherit" }} />
                  <button onClick={addCat} style={{ backgroundColor: "#22c55e", color: "white", border: "none", padding: "10px 15px", borderRadius: 10, cursor: "pointer" }}><Plus size={20} /></button>
                </div>
              </div>
            )}

            {/* نموذج الرفع - للسكرتارية فقط */}
            {user.role === 'secretary' && (
              <form onSubmit={handleUpload} style={{
                backgroundColor: "#0f172a",
                padding: isMobile ? "20px" : "25px",
                borderRadius: 24,
                border: "1px dashed #334155",
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr auto",
                gap: 15,
                alignItems: "end"
              }}>
                <div style={{ gridColumn: isMobile ? "1 / -1" : "auto" }}>
                  <label style={{ display: "block", color: "#94a3b8", fontSize: "0.85rem", marginBottom: 8 }}>عنوان المستند:</label>
                  <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="مثال: تعليمات الصيانة..." style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #334155", backgroundColor: "#1e293b", color: "white", boxSizing: "border-box", fontSize: "1rem" }} />
                </div>
                <div>
                  <label style={{ display: "block", color: "#94a3b8", fontSize: "0.85rem", marginBottom: 8 }}>التصنيف:</label>
                  <select value={category} onChange={e => setCategory(e.target.value)} style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #334155", backgroundColor: "#1e293b", color: "white", boxSizing: "border-box", cursor: "pointer", fontSize: "1rem" }}>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", color: "#94a3b8", fontSize: "0.85rem", marginBottom: 8 }}>اختيار ملف:</label>
                  <input type="file" onChange={e => setSelectedFile(e.target.files[0])} style={{ width: "100%", color: "#94a3b8", fontSize: "0.85rem" }} accept=".pdf,image/*" />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {uploading && (
                    <div style={{ width: "100%", height: 6, backgroundColor: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${uploadProgress}%`, height: "100%", backgroundColor: "#3b82f6", transition: "width 0.3s ease" }} />
                    </div>
                  )}
                  <button type="submit" disabled={uploading} style={{ backgroundColor: "#3b82f6", color: "white", border: "none", borderRadius: 12, padding: "14px 25px", fontWeight: "bold", cursor: uploading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 8, justifyContent: "center", fontSize: "1rem" }}>
                    {uploading ? <RefreshCw size={18} style={{ animation: "spin 1s linear infinite" }} /> : <UploadCloud size={18} />}
                    {uploading ? `جاري الرفع ${uploadProgress}%` : "رفع الملف"}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Files List */}
          <div style={{ display: "grid", gap: 12 }}>
            {loading ? (
              <div style={{ textAlign: "center", padding: 40, color: "#3b82f6" }}><RefreshCw size={30} style={{ animation: "spin 1s linear infinite" }} /></div>
            ) : files.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: "#475569" }}>
                <FileText size={50} style={{ opacity: 0.1, marginBottom: 15 }} />
                <p>لا توجد مستندات مطابقة للبحث</p>
              </div>
            ) : (
              <div style={{ backgroundColor: "#0f172a", borderRadius: 20, overflowX: "auto", border: "1px solid #1e293b", WebkitOverflowScrolling: "touch" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "right", minWidth: isMobile ? "600px" : "auto" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#1e293b" }}>
                      <th style={{ padding: "15px 20px", color: "#94a3b8", fontSize: "0.85rem" }}>اسم المستند</th>
                      <th style={{ padding: "15px 20px", color: "#94a3b8", fontSize: "0.85rem" }}>التصنيف</th>
                      <th style={{ padding: "15px 20px", color: "#94a3b8", fontSize: "0.85rem" }}>تاريخ الرفع</th>
                      <th style={{ padding: "15px 20px", color: "#94a3b8", fontSize: "0.85rem", textAlign: "center" }}>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map(f => (
                      <tr key={f.id} style={{ borderBottom: "1px solid #1e293b" }}>
                        <td style={{ padding: "18px 20px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <div style={{ backgroundColor: "#3b82f615", padding: 8, borderRadius: 10 }}>
                              <FileText size={20} color="#3b82f6" />
                            </div>
                            <span style={{ color: "white", fontWeight: "bold" }}>{f.title}</span>
                          </div>
                        </td>
                        <td style={{ padding: "18px 20px" }}>
                          <span style={{ backgroundColor: "#3b82f620", color: "#3b82f6", padding: "4px 10px", borderRadius: 8, fontSize: "0.8rem", fontWeight: "bold" }}>{f.category}</span>
                        </td>
                        <td style={{ padding: "18px 20px", color: "#64748b", fontSize: "0.9rem" }}>
                          {new Date(f.uploaded_at).toLocaleDateString("ar-EG")}
                        </td>
                        <td style={{ padding: "18px 20px" }}>
                          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                            <a href={`${API_BASE}/api/files/download/${f.id}?token=${getToken()}`} target="_blank" rel="noopener noreferrer" style={{ backgroundColor: "#1e3a8a", color: "#60a5fa", padding: "8px 15px", borderRadius: 10, textDecoration: "none", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: 6, fontWeight: "bold" }}>
                              <Download size={16} /> فتح / تحميل
                            </a>
                            {user.role === 'secretary' && (
                              <button onClick={() => deleteFile(f.id)} style={{ backgroundColor: "#7f1d1d33", color: "#ef4444", border: "none", padding: 8, borderRadius: 10, cursor: "pointer" }}><Trash2 size={18} /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// لوحة إعدادات النظام المتقدمة (للمدير فقط)
// ══════════════════════════════════════════════════════════════════════════════
const SystemPanel = ({ onClose }) => {
  const [downloading, setDownloading] = useState(false);
  const [stats, setStats] = useState(null);

  const fetchStats = async () => {
    try {
      const res = await authFetch('/api/admin/storage-stats');
      if (res.ok) setStats(await res.json());
    } catch { /* ignore */ }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10000); // تحديث كل 10 ثواني
    return () => clearInterval(interval);
  }, []);

  const handleDownloadBackup = async () => {
    setDownloading(true);
    try {
      const response = await authFetch('/api/admin/backup');
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_${new Date().toLocaleDateString('ar-EG').replace(/\//g, '-')}.sqlite`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch { /* ignore */
      alert("تعذر تحميل النسخة الاحتياطية");
    }

    setDownloading(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(2,6,23,0.96)", zIndex: 11000, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "80px 15px 20px", overflowY: "auto" }} dir="rtl">
      <div style={{ backgroundColor: "#1e293b", width: "100%", maxWidth: 600, borderRadius: 28, padding: 30, border: "1px solid #334155", boxShadow: "0 20px 50px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 30 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Settings size={28} color="#3b82f6" />
            <h2 style={{ color: "white", margin: 0, fontSize: "1.4rem" }}>إعدادات النظام المتقدمة</h2>
          </div>
          <X onClick={onClose} style={{ cursor: "pointer", color: "#94a3b8" }} />
        </div>

        <div style={{ display: "grid", gap: 20 }}>
          {/* إحصائيات تقنية */}
          <div style={{ backgroundColor: "#0f172a", padding: "20px 25px", borderRadius: 24, border: "1px solid #334155", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 15 }}>
            <div style={{ textAlign: "center", padding: "10px", borderRight: "1px solid #1e293b" }}>
              <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: 5 }}>حجم الملفات الصوتية</div>
              <div style={{ color: "#3b82f6", fontSize: "1.4rem", fontWeight: "900" }}>{stats ? `${stats.totalSizeMB} MB` : "--"}</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px" }}>
              <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: 5 }}>عدد البصمات بجهازك</div>
              <div style={{ color: "#10b981", fontSize: "1.4rem", fontWeight: "900" }}>{stats ? stats.audioFilesCount : "--"}</div>
            </div>
          </div>

          {/* النسخ الاحتياطي */}
          <div style={{ backgroundColor: "#0f172a", padding: 25, borderRadius: 24, border: "1px solid #1e293b" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div style={{ backgroundColor: "#10b98122", padding: 10, borderRadius: 12 }}>
                <Database size={24} color="#10b981" />
              </div>
              <div>
                <h3 style={{ color: "white", margin: 0, fontSize: "1.1rem" }}>صيانة قاعدة البيانات</h3>
                <p style={{ color: "#64748b", margin: "5px 0 0", fontSize: "0.85rem" }}>تحميل نسخة احتياطية كاملة للمؤرشفات</p>
              </div>
            </div>
            <button
              onClick={handleDownloadBackup}
              disabled={downloading}
              style={{
                width: "100%",
                backgroundColor: downloading ? "#1e293b" : "#10b981",
                color: "white",
                border: "none",
                padding: "16px",
                borderRadius: 16,
                cursor: downloading ? "default" : "pointer",
                fontWeight: "bold",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                transition: "0.3s",
                fontFamily: "inherit",
                fontSize: "1rem"
              }}
            >
              {downloading ? <RefreshCw size={20} style={{ animation: "spin 1s linear infinite" }} /> : <Plus size={20} style={{ transform: "rotate(45deg)" }} />}
              {downloading ? "جاري معالجة الملف..." : "تحميل نسخة احتياطية (Download Backup)"}
            </button>
          </div>

          {/* ميزات قادمة */}
          <div style={{ backgroundColor: "#1e293b", padding: 25, borderRadius: 24, border: "1px dashed #334155", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <ShieldAlert size={32} color="#475569" />
            <p style={{ color: "#64748b", margin: 0, fontSize: "0.9rem" }}>أدوات إضافية للصيانة وتخصيص النظام سيتم توفيرها قريباً...</p>
          </div>
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// واجهة المدير
// ══════════════════════════════════════════════════════════════════════════════
const Manager = ({ user, onLogout, isManagerBusy }) => {
  const isMobile = useIsMobile();
  const [toast, setToast] = useState({ visible: false, msg: "", type: "info" });
  const [customMsgs, setCustomMsgs] = useState({});
  const [recordingId, setRecordingId] = useState(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingIntervalRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showChangePass, setShowCP] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showAgenda, setShowAgenda] = useState(false);
  const [showSystemPanel, setShowSystemPanel] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [sections, setSections] = useState([]);
  const [connected, setConnected] = useState(socket.connected);
  const [effectiveConnected, setEffectiveConnected] = useState(socket.connected);

  // تحديث الحالة "الفعالة" للاتصال - تبقى خضراء لمدة دقيقتين بعد انقطاع السوكيت
  // طالما أن الـ Heartbeat قد ينجح في الخلفية
  useEffect(() => {
    if (connected) {
      setEffectiveConnected(true);
    } else {
      const timeout = setTimeout(() => setEffectiveConnected(false), 120000);
      return () => clearTimeout(timeout);
    }
  }, [connected]);
  // حالة الطلبات الحية: { [logId]: { status, updatedAt } }
  // eslint-disable-next-line no-unused-vars
  const [liveStatus, setLiveStatus] = useState({});

  // ردود المدير العام على طلبات المعاون (بطاقات بجانب الصفحة مثل السكرتارية)
  const [deputyReplies, setDeputyReplies] = useState([]);

  // حالة الغرف (متصل/غير متصل)
  const [roomOnline, setRoomOnline] = useState({});
  const [managerIncoming, setManagerIncoming] = useState([]);
  const [managerAudioEnabled, setManagerAudioEnabled] = useState(false);
  const [showAudioModal, setShowAudioModal] = useState(true);
  const audioRef = useRef(null);
  const [selectedSound, setSelectedSound] = useState(() => localStorage.getItem("app_sound_0") || APP_SOUNDS[0].url);

  // ─── دوال الجلب والمزامنة ──────────────────────────────────────────
  const roomId = user?.role === 'manager' ? 0 : user?.room_id;
  const loadManagerNotifications = useCallback((buster = "") => {
    authFetch(`/api/notifications/${roomId}${buster}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        if (Array.isArray(data)) {
          const pending = data
            .filter(n => !n.completed)
            .map(n => ({
              fromRoomId: n.fromRoomId || n.from_room_id,
              fromName: n.from_name || n.message,
              message: n.message,
              logId: n.logId || n.id,
              sentAt: n.sentAt || n.time || new Date().toISOString(),
              audio: n.audio
            }));
          setManagerIncoming(prev => {
            const existingIds = new Set(prev.map(n => n.logId || n.id));
            const newNotifs = pending.filter(n => !n.completed && !existingIds.has(n.logId || n.id));
            return [...newNotifs, ...prev];
          });
        }
      })
      .catch(console.error);
  }, [roomId]);


  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  // تحميل إعدادات المدير (بما في ذلك النغمة) من السيرفر عند البدء
  useEffect(() => {
    const rId = user?.role === 'manager' ? 0 : user?.room_id;
    authFetch(`/api/receiver-settings/${rId}`)
      .then(r => r.ok ? r.json() : { actions: [], sound_url: null })
      .then(data => {
        if (data.sound_url) {
          setSelectedSound(data.sound_url);
          localStorage.setItem(`app_sound_${rId}`, data.sound_url);
        }
      })
      .catch(console.error);
  }, [user]);
  const [todayAgenda, setTodayAgenda] = useState([]);
  const [remindersGiven, setRemindersGiven] = useState(new Set());

  const changeSound = (url) => {
    const rId = user?.role === 'manager' ? 0 : user?.room_id;
    setSelectedSound(url);
    localStorage.setItem(`app_sound_${rId}`, url);
    socket.emit("update-receiver-settings", { roomId: rId, sound_url: url });

    // تشغيل النغمة للمعاينة بشكل مستقل لضمان عملها
    const previewAudio = new Audio(url);
    previewAudio.play().catch(e => console.error("تعذر تشغيل النغمة:", e));
  };


  const showToast = useCallback((msg, type = "info") => {
    setToast({ visible: true, msg, type });
    setTimeout(() => setToast(p => ({ ...p, visible: false })), 4000);
  }, []);

  const isManagerBusyRef = useRef(isManagerBusy);
  useEffect(() => {
    isManagerBusyRef.current = isManagerBusy;
  }, [isManagerBusy]);

  // ─── مستقبل الإشارات الصاعقة وحماية الخصوصية ───
  useEffect(() => {
    const channel = new BroadcastChannel('smart_intercom_sync');

    // إخبار الـ Service Worker برقم الغرفة الحالي لفلترة الإشعارات
    const updateSWIdentity = () => {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'SET_ROOM_ID',
          roomId: user?.room_id || 0
        });
      }
    };

    // وظيفة الجلب الفوري للبيانات دون انتظار السوكيت
    const handleSync = () => {
      if (!user) return;
      loadManagerNotifications();
      updateSWIdentity();
    };

    channel.onmessage = (event) => {
      if (event.data && event.data.type === 'SYNC_NOW') {
        const time = new Date().toLocaleTimeString();
        console.log(`[MANAGER LOG] 📥 إشعار خارجي في: ${time}`);
        localStorage.setItem('pending_sync_signal', Date.now().toString());
        handleSync();
      }
    };

    const handleNitro = () => {
      console.log("[MANAGER LOG] 🚀 نبضة نيترو لتحديث البيانات...");
      handleSync();

      let count = 0;
      const itv = setInterval(() => {
        loadManagerNotifications(`?t=${Date.now()}_nitro_${count}`);
        count++;
        if (count >= 10) clearInterval(itv);
      }, 500);
    };

    window.addEventListener('nitro_sync_trigger', handleNitro);
    setTimeout(updateSWIdentity, 2000);

    return () => {
      channel.close();
      window.removeEventListener('nitro_sync_trigger', handleNitro);
    };
  }, [user, loadManagerNotifications]);

  // ─── Socket events ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      if (user) {
        const targetRoom = user.role === 'manager' ? 0 : user.room_id;
        socket.emit("join-room", targetRoom);
      }
    };
    const onDisconnect = () => setConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (socket.connected && user) {
      const targetRoom = user.role === 'manager' ? 0 : user.room_id;
      socket.emit("join-room", targetRoom);
    }

    // تأكيد الإرسال من السيرفر
    socket.on("notification-sent", ({ logId }) => {
      setLiveStatus(p => ({ ...p, [logId]: { status: "pending" } }));
    });


    // تحديث حالة طلب (الاستلام/الإنجاز)
    socket.on("notification-status-updated", ({ logId, status, sectionTitle }) => {
      setLiveStatus(p => ({ ...p, [logId]: { status } }));
      const label = status === "received" ? "تم الاستلام ✋" : "تم الإنجاز ✅";
      showToast(`${sectionTitle}: ${label}`, status === "completed" ? "success" : "info");

      // مزامنة حالة الطلب بين الأجهزة: إذا اكتمل الطلب، نزيله من قائمة الإشعارات الواردة فوراً
      if (status === "completed") {
        setManagerIncoming(prev => prev.filter(x => String(x.logId || x.id) !== String(logId)));
        stopAudio();
      }
    });

    // حالة الغرف
    socket.on("room-status", ({ roomId: rid, isOnline }) => {
      setRoomOnline(p => ({ ...p, [rid]: isOnline }));
    });


    socket.on("all-room-statuses", (statuses) => {
      setRoomOnline(p => ({ ...p, ...statuses }));
    });

    // تحديث الأقسام
    socket.on("sections-updated", (updated) => {
      setSections(updated);
      localStorage.setItem("app_sections", JSON.stringify(updated));
    });

    const handleAuthError = (err) => {
      // لا نُسجّل الخروج تلقائياً بسبب خطأ في غرفة Socket
      // الأمان مضمون عبر JWT في كل طلب HTTP
      console.warn("Auth error (socket):", err?.message || err);
    };
    socket.on("auth-error", handleAuthError);


    // إشعارات واردة للمدير أو ردود المدير على طلبات المعاونين
    const handleManagerNotification = (data) => {
      // ─── طبقة الحماية الأولى: لأي رسالة ردّ للمعاون ───────────────────────
      // إذا كانت الرسالة ردًا ("الرد على [...]") وكان المستخدم ليس المدير العام
      // نُوجّهها حتماً لـ deputyReplies ونخرج فوراً - لا تصل أبداً لـ managerIncoming
      if (user?.role !== 'manager' && data.message && data.message.startsWith('الرد على [')) {
        // تحقق من أن الرد موجَّه لهذا المعاون (مقارنة آمنة من ناحية الأنواع)
        const targetRoom = data.toRoomId !== undefined ? parseInt(data.toRoomId) : parseInt(user?.room_id);
        const myRoom = parseInt(user?.room_id);
        if (!isNaN(targetRoom) && !isNaN(myRoom) && targetRoom !== myRoom) return;

        const replyMatch = data.message.match(/الرد على \[(.+?)\]: (.+)/);
        if (replyMatch) {
          const originalMsg = replyMatch[1];
          const replyMsg = replyMatch[2].trim();
          const isApproved = replyMsg.includes('موافق');
          setDeputyReplies(prev => {
            if (prev.some(x => x.logId === data.logId)) return prev;
            return [{
              id: Date.now(),
              logId: data.logId,
              originalMsg,
              replyMsg,
              isApproved,
              time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
            }, ...prev];
          });
          if (managerAudioEnabled && audioRef.current) audioRef.current.play().catch(() => { });
          showNativeNotification(`رد المدير العام: ${replyMsg}`, `على طلب: ${originalMsg}`);
        }
        return; // ← دائماً نخرج هنا إذا كان المستخدم معاوناً والرسالة ردّ
      }

      // ─── طبقة الحماية الثانية: للمدير العام ──────────────────────────────
      // نتجاهل الردود الموجَّهة للمعاونين (toRoomId = 5 أو 7) لمنع ظهورها عند المدير
      if (user?.role === 'manager' && data.message?.startsWith('الرد على [') &&
        data.toRoomId !== undefined && parseInt(data.toRoomId) !== 0) return;

      // ─── طبقة الحماية الثالثة: حارس نهائي ───────────────────────────────
      // لا ندع أي رسالة رد تصل لـ managerIncoming لغير المدير أبداً
      if (user?.role !== 'manager' && data.message?.startsWith('الرد على [')) return;

      setManagerIncoming(prev => {
        if (prev.some(x => x.logId === data.logId)) return prev;
        return [{
          fromRoomId: data.fromRoomId,
          fromName: data.fromName || `غرفة ${data.fromRoomId}`,
          message: data.message,
          logId: data.logId,
          sentAt: data.sentAt || new Date().toISOString(),
          audio: data.audio
        }, ...prev];
      });

      if (!isManagerBusyRef.current && managerAudioEnabled && audioRef.current) audioRef.current.play().catch(() => { });
      showNativeNotification(`طلب جديد من: ${data.fromName || "قسم"}`, data.message);
    };


    socket.on("receive-manager-notification", handleManagerNotification);
    socket.on("receive-notification", handleManagerNotification);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("notification-sent");
      socket.off("notification-status-updated");
      socket.off("room-status");
      socket.off("sections-updated");
      socket.off("receive-manager-notification", handleManagerNotification);
      socket.off("receive-notification", handleManagerNotification);
      socket.off("auth-error", handleAuthError);
      socket.off("auth-error");
    };
  }, [showToast, onLogout, managerAudioEnabled, user]);

  const loadTodayAgenda = useCallback(async () => {
    if (user?.role !== 'manager') return;
    try {
      const today = getLocalDate();
      const res = await authFetch(`/api/agenda/${today}`);
      if (res.ok) setTodayAgenda(await res.json());
    } catch { /* ignore */ }
  }, [user]);

  const lastDateRef = useRef(getLocalDate());

  useEffect(() => {
    loadTodayAgenda();
    const handleAgendaRefresh = (updatedDate) => {
      const today = getLocalDate();
      if (updatedDate === today) loadTodayAgenda();
    };
    socket.on("refresh-agenda", handleAgendaRefresh);
    return () => socket.off("refresh-agenda", handleAgendaRefresh);
  }, [loadTodayAgenda]);

  // فحص جدول الأعمال لتذكير المدير
  useEffect(() => {
    const checkReminders = () => {
      const currentLocDate = getLocalDate();
      if (currentLocDate !== lastDateRef.current) {
        lastDateRef.current = currentLocDate;
        loadTodayAgenda();
        return; // Skip reminder check until new data loads
      }

      if (!todayAgenda || todayAgenda.length === 0) return;

      const now = new Date();
      const currentMins = now.getHours() * 60 + now.getMinutes();

      todayAgenda.forEach(it => {
        // نغفل المهام الملغاة والمنجزة
        if (it.is_done == 1 || it.is_cancelled == 1 || it.is_done === true || it.is_cancelled === true) {
          // إذا تم إنجازها أو إلغاؤها بعد التذكير، نمسحها من الشاشة
          setManagerIncoming(prev => prev.filter(req => req.id !== `reminder-${it.id}`));
          return;
        }

        const [h, m] = it.time.split(":").map(Number);
        const itemMins = h * 60 + m;

        // إذا تبقى للمهمة ربع ساعة أو أقل
        const diff = itemMins - currentMins;
        if (diff > 0 && diff <= 16) {
          if (!remindersGiven.has(it.id)) {
            setManagerIncoming(prev => {
              // تحقق إضافي لمنع تكرار الموعد إذا كان موجوداً بالفعل في القائمة
              if (prev.some(req => req.id === `reminder-${it.id}`)) return prev;
              return [{
                id: `reminder-${it.id}`,
                fromName: "جدول الأعمال (تذكير تلقائي)",
                message: `موعد قادم [ ${it.task} ] الساعة ${it.time}`,
                isReminder: true
              }, ...prev];
            });

            if (managerAudioEnabled && audioRef.current) audioRef.current.play().catch(() => { });
            setRemindersGiven(prev => new Set(prev).add(it.id));
          } else {
            // تحديث رسالة الإشعار في حالة تعديل الموعد واسمه وهو ما زال ضمن وقت الإشعار المعروض
            setManagerIncoming(prev => prev.map(req =>
              req.id === `reminder-${it.id}`
                ? { ...req, message: `موعد قادم [ ${it.task} ] الساعة ${it.time}` }
                : req
            ));
          }
        } else {
          // إذا تعدل الموعد وأصبح بعيداً لأكثر من 16 دقيقة، نزيله من "قائمة المنبهات التم التذكير بها" ومن القائمة
          if (remindersGiven.has(it.id)) {
            setRemindersGiven(prev => {
              const newSet = new Set(prev);
              newSet.delete(it.id);
              return newSet;
            });
            setManagerIncoming(prev => prev.filter(req => req.id !== `reminder-${it.id}`));
          }
        }
      });
    };

    checkReminders();
    const intervalId = setInterval(checkReminders, 10000); // يفحص كل 10 ثواني لضمان عدم تأخير التنبيه
    return () => clearInterval(intervalId);
  }, [todayAgenda, remindersGiven, managerAudioEnabled, loadTodayAgenda]);

  // تكرار تنبيه الصوت للمدير/المعاون إذا كانت هناك طلبات غير مستجابة
  useEffect(() => {
    const hasIncoming = managerIncoming.length > 0;
    const hasUnreadReplies = deputyReplies.some(r => !r.received);

    if (!managerAudioEnabled || (!hasIncoming && !hasUnreadReplies)) return;

    const interval = setInterval(() => {
      if (audioRef.current) {
        audioRef.current.play().catch(() => { });
      }
    }, 8000); // تكرار كل 8 ثواني

    return () => clearInterval(interval);
  }, [managerIncoming, deputyReplies, managerAudioEnabled]);

  // تحميل الأقسام
  useEffect(() => {
    authFetch("/api/sections")
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { setSections(data); localStorage.setItem("app_sections", JSON.stringify(data)); })
      .catch(() => {
        const saved = localStorage.getItem("app_sections");
        if (saved) setSections(JSON.parse(saved));
      });
  }, []);

  useEffect(() => {
    loadManagerNotifications();

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        // إيقاظ فوري وصادم للاتصال
        loadManagerNotifications();
        if (!socket.connected) socket.connect();
        socket.emit("join-room", 0);
        if (window.__forceTriggerHeartbeat) window.__forceTriggerHeartbeat();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    socket.on("connect", loadManagerNotifications);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      socket.off("connect", loadManagerNotifications);
    };
  }, [loadManagerNotifications]);

  const sendOrder = (targetId, message, sectionTitle) => {
    if (!message?.trim()) return;
    const fromName = user?.role === 'manager' ? 'المدير العام' : (user?.role === 'deputy-tech' ? 'معاون المدير الفني' : 'معاون المدير الاداري');
    socket.emit("send-notification", {
      toRoomId: targetId, fromName: fromName,
      message: message.trim(), sectionTitle,
      // fromRoomId ضروري ليعرف المستقبل أين يُرسل الرد
      fromRoomId: roomId,
    });
    showToast(`تم إرسال: ${message}`, "success");
    setCustomMsgs(p => ({ ...p, [targetId]: "" }));
  };

  const toggleRecording = async (targetId, sectionTitle) => {
    if (recordingId === targetId) {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
        if (mediaRecorderRef.current.stream) mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      }
      setRecordingId(null);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        mediaRecorder.onstop = () => {
          clearInterval(recordingIntervalRef.current);
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.readAsDataURL(blob);
          reader.onloadend = () => {
            const base64Audio = reader.result;
            socket.emit("send-notification", {
              toRoomId: targetId,
              fromName: user?.role === 'manager' ? 'المدير العام' : (user?.role === 'deputy-tech' ? 'معاون المدير الفني' : 'معاون المدير الاداري'),
              message: "بصمة صوتية 🎤", sectionTitle, audio: base64Audio,
              fromRoomId: roomId,
            });
            showToast("تم إرسال البصمة الصوتية ✅", "success");
          };
        };

        mediaRecorder.start();
        setRecordingSeconds(0);
        recordingIntervalRef.current = setInterval(() => {
          setRecordingSeconds(p => {
            if (p >= 300) { // 5 minutes limit
              mediaRecorder.stop();
              showToast("انتهى الحد الأقصى للتسجيل (5 دقائق)", "info");
              return p;
            }
            return p + 1;
          });
        }, 1000);
        setRecordingId(targetId);
      } catch { /* microphone access denied */
        showToast("فشل الوصل للميكروفون، يرجى السماح له", "error");
      }

    }
  };

  const replyToSection = (req, replyMsg) => {
    stopAudio();
    // استخدام fromRoomId المُرسَل صراحةً أولاً، ثم البحث عن القسم بالاسم كبديل
    const targetSection = sections.find(s => s.title === req.fromName);
    const toRoomId = req.fromRoomId || (targetSection ? targetSection.id : null);

    console.log('[REPLY DEBUG] req:', req, '→ toRoomId:', toRoomId);

    if (toRoomId) {
      socket.emit("send-notification", {
        toRoomId: toRoomId,
        fromName: "المدير العام",
        message: `الرد على [${req.message}]: ${replyMsg}`,
        sectionTitle: targetSection ? targetSection.title : "المدير العام",
        fromRoomId: 0,
      });
      showToast("تم إرسال الرد ✅", "success");
    } else {
      console.error('[REPLY DEBUG] لم يتم العثور على toRoomId! req.fromRoomId:', req.fromRoomId, 'req.fromName:', req.fromName);
      showToast("تعذر الرد: لم يتم التعرف على المُرسِل", "error");
    }

    const idToRemove = req.logId || req.id;
    setManagerIncoming(prev => prev.filter(x => String(x.logId || x.id) !== String(idToRemove)));
    if (idToRemove) {
      socket.emit("update-notification-status", { logId: idToRemove, status: "completed" });
    }
  };

  const dismissManagerNotification = (id) => {
    stopAudio();
    setManagerIncoming(prev => prev.filter(x => String(x.logId || x.id) !== String(id)));
    if (id) socket.emit("update-notification-status", { logId: id, status: "completed" });
  };

  const addAction = (sectionId, actionName) => {
    if (!actionName.trim()) return;
    const updated = sections.map(s => s.id === sectionId ? { ...s, actions: [...s.actions, actionName] } : s);
    setSections(updated);
    socket.emit("update-sections", updated);
  };

  const removeAction = (sectionId, index) => {
    const updated = sections.map(s => s.id === sectionId ? { ...s, actions: s.actions.filter((_, i) => i !== index) } : s);
    setSections(updated);
    socket.emit("update-sections", updated);
  };

  const getIcon = (name, size, color) => {
    if (name === "User") return <User {...{ size, color }} />;
    if (name === "Briefcase") return <Briefcase {...{ size, color }} />;
    if (name === "Coffee") return <Coffee {...{ size, color }} />;
    return <Bell {...{ size, color }} />;
  };

  return (
    <FullScreenWrapper>
      <TopBar user={user} onLogout={onLogout} onChangePassword={() => setShowCP(true)} connected={effectiveConnected} />
      {showChangePass && <ChangePasswordModal onClose={() => setShowCP(false)} onSuccess={m => showToast(m, "success")} />}
      {showLogs && <LogsPanel onClose={() => setShowLogs(false)} initialTab={showLogs === "stats" ? "stats" : "logs"} />}
      {showAgenda && <AgendaPanel user={user} onClose={() => setShowAgenda(false)} />}
      {showSystemPanel && <SystemPanel onClose={() => setShowSystemPanel(false)} />}
      {showFiles && <FilesPanel user={user} onClose={() => setShowFiles(false)} showToast={showToast} />}

      <audio ref={audioRef} src={selectedSound} preload="auto" />

      {/* إشعارات واردة للمدير (شاشة عريضة لضمان عدم التجاهل) */}
      {managerIncoming.filter(req =>
        // للمعاوين: نخفي ردود المدير من المنبثق (تظهر كبطاقات أسفل الصفحة فقط)
        !(user?.role !== 'manager' && req.message?.startsWith('الرد على [')) &&
        !req.isManagerReply
      ).length > 0 && (
          <div style={{
            position: "fixed", inset: 0, backgroundColor: "rgba(15, 23, 42, 0.85)", zIndex: 9999,
            display: "flex", justifyContent: "center", alignItems: "center", backdropFilter: "blur(5px)",
            animation: "fadeIn 0.2s ease"
          }}>
            <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}}`}</style>
            <div style={{ display: "flex", flexDirection: "column", gap: 20, maxHeight: "90vh", overflowY: "auto", padding: 20 }}>
              {managerIncoming.map(req => {
                const reqId = req.logId || req.id;
                // فلتر 1: لا نعرض isManagerReply في المودال
                if (req.isManagerReply) return null;
                // فلتر 2: للمعاونين - لا نعرض ردود المدير في المنبثق (تظهر فقط كبطاقات أسفل الصفحة)
                if (user?.role !== 'manager' && req.message?.startsWith('الرد على [')) return null;
                return (
                  <div key={reqId} style={{
                    backgroundColor: "#1e293b", padding: isMobile ? 20 : 35, borderRadius: isMobile ? 24 : 32, border: "3px solid #f59e0b",
                    boxShadow: "0 25px 50px -12px rgba(0,0,0,0.8)", width: isMobile ? "94%" : 450, maxWidth: "100%", animation: "scaleIn 0.35s ease", textAlign: "center",
                    boxSizing: "border-box"
                  }} dir="rtl">
                    <style>{`@keyframes scaleIn{from{opacity:0;transform:scale(0.9)}to{opacity:1;transform:scale(1)}}`}</style>
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 15 }}><Bell size={45} color="#f59e0b" className="pulse-icon" /></div>
                    <style>{`.pulse-icon { animation: pulse 1.5s infinite; } @keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.15); } 100% { transform: scale(1); } }`}</style>
                    <div style={{ color: "#94a3b8", fontSize: isMobile ? "0.9rem" : "1.1rem", marginBottom: 10 }}>نداء عاجل وارد من: <strong style={{ color: "#3b82f6", fontSize: isMobile ? "1.1rem" : "1.4rem" }}>{req.fromName}</strong></div>
                    <div style={{ color: "white", fontSize: isMobile ? "1.5rem" : "2.1rem", fontWeight: 900, marginBottom: req.audio ? 15 : 30, lineHeight: 1.4 }}>{req.message}</div>
                    {req.audio && (
                      <audio
                        src={req.audio.startsWith('data:') ? req.audio : `${SERVER_URL}${req.audio}${req.audio.includes('?') ? '&' : '?'}token=${getToken()}`}
                        controls
                        style={{ width: "100%", marginBottom: 30 }}
                      />
                    )}
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                      {!req.isReminder && <button onClick={() => replyToSection(req, "موافق")} style={{ flex: 1, padding: isMobile ? "12px" : "18px", backgroundColor: "#22c55e", color: "white", border: "none", borderRadius: 16, cursor: "pointer", fontWeight: "bold", fontFamily: "inherit", fontSize: isMobile ? "1rem" : "1.2rem", boxShadow: "0 10px 15px -3px rgba(34,197,94,0.4)", minWidth: isMobile ? "90px" : "120px" }}>موافق ✅</button>}
                      {!req.isReminder && <button onClick={() => replyToSection(req, "ليس بعد")} style={{ flex: 1, padding: isMobile ? "12px" : "18px", backgroundColor: "#ef4444", color: "white", border: "none", borderRadius: 16, cursor: "pointer", fontWeight: "bold", fontFamily: "inherit", fontSize: isMobile ? "1rem" : "1.2rem", boxShadow: "0 10px 15px -3px rgba(239,68,68,0.4)", minWidth: isMobile ? "90px" : "120px" }}>ليس بعد ⏳</button>}
                      <button onClick={() => dismissManagerNotification(reqId)} style={{ padding: isMobile ? "12px" : "18px", backgroundColor: "#475569", color: "white", border: "none", borderRadius: 16, cursor: "pointer", fontWeight: "bold", fontFamily: "inherit", fontSize: isMobile ? "1rem" : "1.2rem" }} title="تجاهل وإغلاق الإشعار">❌</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

      <div style={{ width: "100%", padding: isMobile ? "130px 14px 40px" : "90px 5% 40px", boxSizing: "border-box" }} dir="rtl">
        <CustomToast visible={toast.visible} message={toast.msg} type={toast.type} />

        {/* تفعيل الصوت للمدير */}
        {showAudioModal && (
          <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(2,6,23,0.98)", zIndex: 10000, display: "flex", justifyContent: "center", alignItems: "center" }}>
            <div style={{ backgroundColor: "#1e293b", padding: "55px", borderRadius: 38, textAlign: "center", width: "85%", maxWidth: 480, border: "1px solid #334155" }}>
              <Volume2 size={90} color="#3b82f6" style={{ marginBottom: 24 }} />
              <h2 style={{ fontSize: "1.9rem", color: "white" }}>تفعيل نظام الصوت والإشعارات</h2>
              <button onClick={() => {
                setManagerAudioEnabled(true);
                setShowAudioModal(false);
                if ('wakeLock' in navigator) {
                  navigator.wakeLock.request('screen').catch(() => { });
                }
                // تفعيل نظام النبض الصامت للمدير لإبقاء التطبيق حياً في الخلفية
                startSilentKeepAlive(() => {
                  performHeartbeat(() => {
                    // الجلب الفوري للطلبات عند كل نبضة
                    loadManagerNotifications();
                  });
                });

                loadManagerNotifications();
                loadTodayAgenda();

                // تفعيل دفع الإشعارات تلقائياً عند الدخول (WhatsApp Style)
                if (localStorage.getItem("web_push_enabled") !== "true") {
                  subscribeToPush().catch(console.error);
                }
              }} style={{
                backgroundColor: "#3b82f6", color: "white", border: "none",
                padding: "22px 45px", borderRadius: 22, fontSize: "1.4rem", fontWeight: "bold",
                cursor: "pointer", width: "100%", marginTop: 24, fontFamily: "inherit",
              }}>تفعيل الآن 🔔</button>
            </div>
          </div>
        )}

        <header style={{ marginBottom: 40, textAlign: "center" }}>

          <h1 style={{ fontSize: "calc(1.6rem + 1.2vw)", fontWeight: 900, margin: "0 0 12px", color: "#ffffff" }}>
            نظام النداء والخدمات المركزية
          </h1>
          {/* مؤشرات حالة الغرف تم إخفاؤها */}
        </header>


        {/* أزرار أدوات أعلى الشاشة لتفادي التداخل */}
        <div style={{ display: "flex", justifyContent: "center", gap: isMobile ? 8 : 12, zIndex: 50, flexWrap: "wrap", marginBottom: 30, backgroundColor: "#1e293b", padding: "15px", borderRadius: 20, border: "1px solid #334155" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 15px", borderRadius: 12, backgroundColor: effectiveConnected ? "#14532d33" : "#450a0a33", border: `1px solid ${effectiveConnected ? "#22c55e" : "#ef4444"}` }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: effectiveConnected ? "#22c55e" : "#ef4444", boxShadow: effectiveConnected ? "0 0 8px #22c55e" : "none" }}></span>
            <span style={{ fontSize: "0.85rem", color: effectiveConnected ? "#86efac" : "#fca5a5", fontWeight: "bold" }}>{effectiveConnected ? "النظام متصل" : "جاري إعادة الاتصال..."}</span>
          </div>
          {user?.role === "manager" && (
            <button
              onClick={() => socket.emit("set-manager-busy", !isManagerBusy)}
              title={isManagerBusy ? "مشغول (في اجتماع)" : "متاح"}
              style={{ background: isManagerBusy ? "#ef4444" : "#22c55e", border: "1px solid transparent", padding: "11px 16px", borderRadius: 14, cursor: "pointer", color: "white", display: "flex", alignItems: "center", gap: 6, fontWeight: "bold", fontFamily: "inherit" }}>
              {isManagerBusy ? "🔕 مشغول" : "🔔 متاح"}
            </button>
          )}

          <button onClick={() => setShowSettings(true)} title="إعدادات" style={{ background: "#0f172a", border: "1px solid #3b82f6", padding: 11, borderRadius: 14, cursor: "pointer", color: "white", display: "flex", alignItems: "center", gap: 5 }}>
            <Settings size={22} color="#3b82f6" /> {isMobile ? "" : "إعدادات"}
          </button>
          {user?.role === "manager" && (
            <button onClick={() => setShowAgenda(true)} title="جدول الأعمال" style={{ background: "#2e1065", border: "1px solid #a855f7", padding: 11, borderRadius: 14, cursor: "pointer", color: "#d8b4fe", display: "flex", alignItems: "center", gap: 5 }}>
              <Calendar size={22} /> {isMobile ? "" : "الجدول"}
            </button>
          )}
          {user?.role === "manager" && (
            <>
              <button onClick={() => setShowLogs("logs")} title="سجل الطلبات" style={{ background: "#1e3a8a", border: "1px solid #3b82f6", padding: 11, borderRadius: 14, cursor: "pointer", color: "#bfdbfe", display: "flex", alignItems: "center", gap: 5 }}>
                <History size={22} /> {isMobile ? "" : "السجل"}
              </button>
              <button onClick={() => setShowLogs("stats")} title="الإحصائيات" style={{ background: "#0f172a", border: "1px solid #a855f7", padding: 11, borderRadius: 14, cursor: "pointer", color: "#a855f7", display: "flex", alignItems: "center", gap: 5 }}>
                <BarChart2 size={22} /> {isMobile ? "" : "الإحصاء"}
              </button>
              <button onClick={() => setShowFiles(true)} title="الملفات المهمة" style={{ background: "#0f172a", border: "1px solid #3b82f6", padding: 11, borderRadius: 14, cursor: "pointer", color: "#bfdbfe", display: "flex", alignItems: "center", gap: 5 }}>
                <FileText size={22} color="#3b82f6" /> {isMobile ? "" : "الملفات"}
              </button>
              <button onClick={() => setShowSystemPanel(true)} title="النظام" style={{ background: "#0f172a", border: "1px solid #10b981", padding: 11, borderRadius: 14, cursor: "pointer", color: "#10b981", display: "flex", alignItems: "center", gap: 5 }}>
                <Database size={22} /> {isMobile ? "" : "النظام"}
              </button>
            </>
          )}
        </div>

        {/* الأقسام الأساسية (السكرتارية، المكتب، المطبخ) - للمدير فقط */}
        {user?.role === 'manager' && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 28, width: "100%", marginBottom: 28 }}>
            {[...sections].filter(s => [2, 4, 3].includes(s.id)).sort((a, b) => {
              const order = ["قسم السكرتارية", "إدارة المكتب", "خدمات المطبخ"];
              let idxA = order.indexOf(a.title);
              let idxB = order.indexOf(b.title);
              if (idxA === -1) idxA = 99;
              if (idxB === -1) idxB = 99;
              return idxA - idxB;
            }).map(s => (
              <div key={s.id} style={{
                backgroundColor: "#1e293b", padding: 28, borderRadius: 32,
                border: "1px solid #334155", boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
                display: "flex", flexDirection: "column",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 22, borderBottom: `2px solid ${s.color}44`, paddingBottom: 14 }}>
                  <div style={{ display: "flex" }}>{getIcon(s.iconName, 32, s.color)}</div>
                  <h2 style={{ fontSize: "1.6rem", margin: 0, color: "#fff", fontWeight: 800 }}>{s.title}</h2>
                  <div style={{ width: 9, height: 9, borderRadius: "50%", backgroundColor: roomOnline[s.id] ? "#22c55e" : "#475569", marginRight: "auto", ...(roomOnline[s.id] ? { boxShadow: "0 0 8px #22c55e" } : {}) }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                  {s.actions.map(act => (
                    <button key={act} onClick={() => sendOrder(s.id, act, s.title)} style={{
                      backgroundColor: "#0f172a", color: "#fff", border: "1px solid #334155",
                      padding: "17px 10px", borderRadius: 16, cursor: "pointer", fontWeight: "bold",
                      fontSize: "1rem", transition: "all 0.25s", fontFamily: "inherit",
                    }}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = s.color + "22"; e.currentTarget.style.borderColor = s.color; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = "#0f172a"; e.currentTarget.style.borderColor = "#334155"; }}>
                      {act}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, backgroundColor: "#0f172a", padding: "8px 12px", borderRadius: 18, border: `1px dashed ${s.color}55`, alignItems: "center", flexWrap: "wrap" }}>
                  {recordingId === s.id ? (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, color: "#ef4444", fontWeight: "bold", fontSize: "1.1rem", padding: "5px" }}>
                      <div style={{ width: 12, height: 12, backgroundColor: "#ef4444", borderRadius: "50%", animation: "pulseDot 1.5s infinite" }} />
                      جاري التسجيل... {Math.floor(recordingSeconds / 60).toString().padStart(2, "0")}:{(recordingSeconds % 60).toString().padStart(2, "0")}
                    </div>
                  ) : (
                    <input type="text" placeholder="نداء مخصص..."
                      value={customMsgs[s.id] || ""}
                      onChange={e => setCustomMsgs(p => ({ ...p, [s.id]: e.target.value }))}
                      onKeyDown={e => e.key === "Enter" && sendOrder(s.id, customMsgs[s.id], s.title)}
                      style={{ flex: 1, backgroundColor: "transparent", border: "none", color: "white", padding: "7px", fontSize: "0.95rem", outline: "none", minWidth: 100, fontFamily: "inherit" }} />
                  )}
                  {!recordingId && (
                    <button onClick={() => sendOrder(s.id, customMsgs[s.id], s.title)} style={{
                      backgroundColor: s.color, color: "white", border: "none",
                      borderRadius: 11, padding: "9px 14px", display: "flex", cursor: "pointer", flexShrink: 0
                    }}>
                      <Send size={16} />
                    </button>
                  )}
                  <button onClick={() => toggleRecording(s.id, s.title)} style={{
                    backgroundColor: recordingId === s.id ? "#ef4444" : "#475569", color: "white", border: "none",
                    borderRadius: 11, padding: "9px 14px", display: "flex", cursor: "pointer", transition: "0.2s", flexShrink: 0
                  }} title="تسجيل بصمة صوتية">
                    {recordingId === s.id ? <Square size={16} /> : <Mic size={16} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* بطاقات مساعدة ومعاونين */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 28, width: "100%" }}>
          {[...sections].filter(s => {
            if (user?.role === 'manager') return [5, 7].includes(s.id);
            if (user?.role === 'deputy-tech') return [0, 6].includes(s.id);
            if (user?.role === 'deputy-admin') return [0, 8].includes(s.id);
            return false;
          }).sort((a, b) => {
            const order = ["معاون المدير العام للشؤون الفنية", "معاون المدير العام للشؤون الادارية والمالية", "المدير العام", "ادارة المكتب الخاص به (فني)", "ادارة المكتب الخاص به (اداري)"];
            let idxA = order.indexOf(a.title);
            let idxB = order.indexOf(b.title);
            if (idxA === -1) idxA = 99;
            if (idxB === -1) idxB = 99;
            return idxA - idxB;
          }).map(s => (
            <div key={s.id} style={{
              backgroundColor: "#1e293b", padding: 28, borderRadius: 32,
              border: "1px solid #334155", boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
              display: "flex", flexDirection: "column",
            }}>
              {/* رأس القسم */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 22, borderBottom: `2px solid ${s.color}44`, paddingBottom: 14 }}>
                <div style={{ display: "flex" }}>{getIcon(s.iconName, 32, s.color)}</div>
                <h2 style={{ fontSize: "1.6rem", margin: 0, color: "#fff", fontWeight: 800 }}>{s.title}</h2>
                {/* مؤشر اتصال الغرفة */}
                <div style={{ width: 9, height: 9, borderRadius: "50%", backgroundColor: roomOnline[s.id] ? "#22c55e" : "#475569", marginRight: "auto", ...(roomOnline[s.id] ? { boxShadow: "0 0 8px #22c55e" } : {}) }} />
              </div>

              {/* أزرار الأفعال */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                {s.actions.map(act => (
                  <button key={act} onClick={() => sendOrder(s.id, act, s.title)} style={{
                    backgroundColor: "#0f172a", color: "#fff", border: "1px solid #334155",
                    padding: "17px 10px", borderRadius: 16, cursor: "pointer", fontWeight: "bold",
                    fontSize: "1rem", transition: "all 0.25s", fontFamily: "inherit",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = s.color + "22"; e.currentTarget.style.borderColor = s.color; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = "#0f172a"; e.currentTarget.style.borderColor = "#334155"; }}>
                    {act}
                  </button>
                ))}
              </div>

              {/* رسالة مخصصة */}
              <div style={{ display: "flex", gap: 8, backgroundColor: "#0f172a", padding: "8px 12px", borderRadius: 18, border: `1px dashed ${s.color}55`, alignItems: "center", flexWrap: "wrap" }}>
                {recordingId === s.id ? (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, color: "#ef4444", fontWeight: "bold", fontSize: "1.1rem", padding: "5px" }}>
                    <div style={{ width: 12, height: 12, backgroundColor: "#ef4444", borderRadius: "50%", animation: "pulseDot 1.5s infinite" }} />
                    <style>{`@keyframes pulseDot { 0% { transform: scale(0.8); opacity: 1; } 50% { transform: scale(1.4); opacity: 0.4; } 100% { transform: scale(0.8); opacity: 1; } }`}</style>
                    جاري التسجيل... {Math.floor(recordingSeconds / 60).toString().padStart(2, "0")}:{(recordingSeconds % 60).toString().padStart(2, "0")}
                  </div>
                ) : (
                  <input type="text" placeholder="نداء مخصص..."
                    value={customMsgs[s.id] || ""}
                    onChange={e => setCustomMsgs(p => ({ ...p, [s.id]: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && sendOrder(s.id, customMsgs[s.id], s.title)}
                    style={{ flex: 1, backgroundColor: "transparent", border: "none", color: "white", padding: "7px", fontSize: "0.95rem", outline: "none", minWidth: 100, fontFamily: "inherit" }} />
                )}
                {!recordingId && (
                  <button onClick={() => sendOrder(s.id, customMsgs[s.id], s.title)} style={{
                    backgroundColor: s.color, color: "white", border: "none",
                    borderRadius: 11, padding: "9px 14px", display: "flex", cursor: "pointer", flexShrink: 0
                  }}>
                    <Send size={16} />
                  </button>
                )}
                <button onClick={() => toggleRecording(s.id, s.title)} style={{
                  backgroundColor: recordingId === s.id ? "#ef4444" : "#475569", color: "white", border: "none",
                  borderRadius: 11, padding: "9px 14px", display: "flex", cursor: "pointer", transition: "0.2s", flexShrink: 0
                }} title="تسجيل بصمة صوتية">
                  {recordingId === s.id ? <Square size={16} /> : <Mic size={16} />}
                </button>
              </div>
            </div>
          ))}

          {/* بطاقة مراسلة الأقسام الأخرى من خلال قائمة منسدلة */}
          <div style={{
            backgroundColor: "#1e293b", padding: 28, borderRadius: 32,
            border: "2px dashed #3b82f6", boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
            display: "flex", flexDirection: "column",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 22, borderBottom: `2px solid #3b82f644`, paddingBottom: 14 }}>
              <div style={{ display: "flex" }}><Briefcase size={32} color="#3b82f6" /></div>
              <h2 style={{ fontSize: "1.6rem", margin: 0, color: "#fff", fontWeight: 800 }}>مراسلة كافة الأقسام والمديريات</h2>
            </div>

            <div style={{ marginBottom: 15 }}>
              <select
                value={customMsgs['generic_dep_id'] || ""}
                onChange={e => setCustomMsgs(p => ({ ...p, generic_dep_id: e.target.value }))}
                style={{ width: "100%", padding: "12px", borderRadius: "14px", backgroundColor: "#0f172a", color: "white", border: "1px solid #334155", fontFamily: "inherit", fontSize: "1.1rem" }}>
                <option value="" disabled>-- اختر القسم أو المديرية --</option>
                {[...sections].filter(s => s.id >= 9 && s.id <= 33).sort((a, b) => a.title.localeCompare(b.title)).map(s => (
                  <option key={s.id} value={s.id}>{s.title}{roomOnline[s.id] ? " 🟢" : ""}</option>
                ))}
              </select>
              {/* مؤشر الاتصال يظهر فقط إذا كان القسم متصلاً */}
              {customMsgs['generic_dep_id'] && roomOnline[parseInt(customMsgs['generic_dep_id'])] && (
                <div style={{ marginTop: 6, fontSize: "0.82rem", color: "#22c55e", display: "flex", alignItems: "center", gap: 5, paddingRight: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: "#22c55e", display: "inline-block", boxShadow: "0 0 6px #22c55e" }} />
                  القسم متصل حالياً
                </div>
              )}
            </div>


            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              {["يرجى الحضور", "لإجراء اللازم", "مذكرة جاهزة", "طلب تقرير"].map(act => (
                <button key={act} onClick={() => {
                  const targetId = parseInt(customMsgs['generic_dep_id']);
                  if (!targetId) return showToast("يرجى اختيار القسم أولاً من القائمة", "error");
                  const targetTitle = sections.find(s => s.id === targetId)?.title || "القسم";
                  sendOrder(targetId, act, targetTitle);
                }} style={{
                  backgroundColor: "#0f172a", color: "#fff", border: "1px solid #334155",
                  padding: "12px 10px", borderRadius: 16, cursor: "pointer", fontWeight: "bold",
                  fontSize: "0.95rem", transition: "all 0.25s", fontFamily: "inherit",
                }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = "#3b82f622"; e.currentTarget.style.borderColor = "#3b82f6"; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = "#0f172a"; e.currentTarget.style.borderColor = "#334155"; }}>
                  {act}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, backgroundColor: "#0f172a", padding: "8px 12px", borderRadius: 18, border: `1px dashed #3b82f655`, alignItems: "center", flexWrap: "wrap" }}>
              {recordingId === parseInt(customMsgs['generic_dep_id']) && recordingId >= 9 ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, color: "#ef4444", fontWeight: "bold", fontSize: "1.1rem", padding: "5px" }}>
                  <div style={{ width: 12, height: 12, backgroundColor: "#ef4444", borderRadius: "50%", animation: "pulseDot 1.5s infinite" }} />
                  جاري التسجيل... {Math.floor(recordingSeconds / 60).toString().padStart(2, "0")}:{(recordingSeconds % 60).toString().padStart(2, "0")}
                </div>
              ) : (
                <input type="text" placeholder="نداء مخصص..."
                  value={customMsgs['generic_dep'] || ""}
                  onChange={e => setCustomMsgs(p => ({ ...p, 'generic_dep': e.target.value }))}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      const targetId = parseInt(customMsgs['generic_dep_id']);
                      if (!targetId) return showToast("يرجى اختيار القسم أولاً", "error");
                      const targetTitle = sections.find(s => s.id === targetId)?.title || "";
                      sendOrder(targetId, customMsgs['generic_dep'], targetTitle);
                      setCustomMsgs(p => ({ ...p, 'generic_dep': "" }));
                    }
                  }}
                  style={{ flex: 1, backgroundColor: "transparent", border: "none", color: "white", padding: "7px", fontSize: "0.95rem", outline: "none", minWidth: 100, fontFamily: "inherit" }} />
              )}
              {(!recordingId || recordingId < 9) && (
                <button onClick={() => {
                  const targetId = parseInt(customMsgs['generic_dep_id']);
                  if (!targetId) return showToast("يرجى اختيار القسم أولاً", "error");
                  const targetTitle = sections.find(s => s.id === targetId)?.title || "";
                  sendOrder(targetId, customMsgs['generic_dep'], targetTitle);
                  setCustomMsgs(p => ({ ...p, 'generic_dep': "" }));
                }} style={{
                  backgroundColor: "#3b82f6", color: "white", border: "none",
                  borderRadius: 11, padding: "9px 14px", display: "flex", cursor: "pointer", flexShrink: 0
                }}>
                  <Send size={16} />
                </button>
              )}
              <button onClick={() => {
                const targetId = parseInt(customMsgs['generic_dep_id']);
                if (!targetId) return showToast("يرجى اختيار القسم أولاً لتسجيل الصوت", "error");
                const targetTitle = sections.find(s => s.id === targetId)?.title || "القسم";
                toggleRecording(targetId, targetTitle);
              }} style={{
                backgroundColor: recordingId === parseInt(customMsgs['generic_dep_id']) && recordingId >= 9 ? "#ef4444" : "#475569", color: "white", border: "none",
                borderRadius: 11, padding: "9px 14px", display: "flex", cursor: "pointer", transition: "0.2s", flexShrink: 0
              }} title="تسجيل بصمة صوتية للقسم">
                {recordingId === parseInt(customMsgs['generic_dep_id']) && recordingId >= 9 ? <Square size={16} /> : <Mic size={16} />}
              </button>
            </div>
          </div>
        </div>

        {/* بطاقات ردود المدير للمعاونين - بنفس شكل بطاقات الأقسام الأخرى */}
        {user?.role !== 'manager' && deputyReplies.length > 0 && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 18, marginTop: 28 }} dir="rtl">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <h3 style={{ color: '#94a3b8', fontSize: '1.1rem', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Bell size={18} color="#3b82f6" /> طلباتي للمدير العام
              </h3>
              <button onClick={() => setDeputyReplies([])} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.8rem' }}>مسح الكل</button>
            </div>
            {deputyReplies.map(reply => (
              <div key={reply.id} style={{
                backgroundColor: '#1e293b',
                padding: isMobile ? '22px' : '36px',
                borderRadius: isMobile ? 26 : 32,
                display: 'flex', flexDirection: isMobile ? 'column' : 'row',
                justifyContent: 'space-between', alignItems: isMobile ? 'stretch' : 'center',
                borderRight: `${isMobile ? 7 : 11}px solid ${reply.isApproved ? '#22c55e' : '#ef4444'}`,
                boxShadow: '0 12px 35px rgba(0,0,0,0.3)', gap: isMobile ? 20 : 0,
                animation: 'slideIn 0.35s ease',
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>{reply.time}</span>
                    <StatusBadge status={reply.received ? 'received' : 'pending'} />
                  </div>
                  <h2 style={{ fontSize: isMobile ? '1.9rem' : '2.8rem', margin: 0, fontWeight: 900, color: 'white', marginBottom: 8 }}>
                    الرد على [{reply.originalMsg}]: <span style={{ color: reply.isApproved ? '#22c55e' : '#ef4444' }}>{reply.replyMsg}</span>
                  </h2>
                </div>
                <div style={{ display: 'flex', gap: 13, flexWrap: 'wrap' }}>
                  {!reply.received && (
                    <button
                      onClick={() => {
                        stopAudio();
                        setDeputyReplies(prev => prev.map(r => r.id === reply.id ? { ...r, received: true } : r));
                        if (reply.logId) socket.emit("update-notification-status", { logId: reply.logId, status: "received" });
                      }}
                      style={{
                        backgroundColor: '#3b82f6', color: 'white', padding: '12px 18px', borderRadius: 16,
                        border: 'none', fontWeight: 'bold', flex: 1, fontSize: '1rem', cursor: 'pointer', fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                      }}>
                      <span>استلام</span> <span style={{ fontSize: '1.2rem' }}>✋</span>
                    </button>
                  )}
                  <button
                    onClick={() => {
                      stopAudio();
                      setDeputyReplies(prev => prev.filter(r => r.id !== reply.id));
                      if (reply.logId) socket.emit("update-notification-status", { logId: reply.logId, status: "completed" });
                    }}
                    style={{
                      backgroundColor: '#22c55e', color: 'white', padding: '12px 18px', borderRadius: 16,
                      border: 'none', fontWeight: 'bold', flex: 1, fontSize: '1rem', cursor: 'pointer', fontFamily: 'inherit',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                    }}>
                    <span>إنجاز</span> <span style={{ fontSize: '1.2rem' }}>✅</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}


        {/* نافذة الإعدادات */}
        {showSettings && (
          <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(2,6,23,0.96)", zIndex: 10001, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "80px 15px 20px", overflowY: "auto" }}>
            <div style={{ backgroundColor: "#1e293b", width: "100%", maxWidth: 1000, borderRadius: 28, padding: 30, border: "1px solid #334155" }}>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <h2 style={{ color: "white", margin: 0 }}>تخصيص الإعدادات</h2>
                <X onClick={() => setShowSettings(false)} style={{ cursor: "pointer", color: "#94a3b8" }} />
              </div>

              {/* تخصيص النغمة للمدير */}
              <div style={{ marginBottom: 30, padding: 20, border: "1px solid #334155", borderRadius: 20, backgroundColor: "#0f172a" }}>
                <h3 style={{ color: "white", marginTop: 0, marginBottom: 18, display: "flex", alignItems: "center", gap: 10 }}>
                  <Volume2 size={24} color="#3b82f6" />
                  نغمة الإشعارات (للمدير العام)
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
                  {APP_SOUNDS.map(s => (
                    <button key={s.id} onClick={() => changeSound(s.url)} style={{
                      background: selectedSound === s.url ? "#3b82f6" : "#1e293b",
                      color: selectedSound === s.url ? "white" : "#94a3b8",
                      border: `2px solid ${selectedSound === s.url ? "#3b82f6" : "#334155"}`,
                      padding: "12px", borderRadius: "14px", cursor: "pointer", fontFamily: "inherit", fontWeight: "bold", fontSize: "0.95rem"
                    }}>
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>

              <h3 style={{ color: "white", marginTop: 0, marginBottom: 15 }}>تخصيص أزرار الأقسام</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16 }}>
                {sections.map(section => (
                  <div key={section.id} style={{ marginBottom: 8, padding: 14, border: "1px solid #334155", borderRadius: 18 }}>
                    <h3 style={{ color: section.color, marginTop: 0 }}>{section.title}</h3>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginBottom: 13 }}>
                      {section.actions.map((action, index) => (
                        <div key={index} style={{ background: "#0f172a", color: "white", padding: "7px 11px", borderRadius: 9, display: "flex", alignItems: "center", gap: 7 }}>
                          {action}
                          <Trash2 size={13} color="#ef4444" style={{ cursor: "pointer" }} onClick={() => removeAction(section.id, index)} />
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 9 }}>
                      <input type="text" id={`new-act-${section.id}`} placeholder="اسم الزر الجديد..."
                        style={{ flex: 1, background: "#0f172a", border: "none", color: "white", padding: "9px", borderRadius: 9, fontFamily: "inherit" }}
                        onKeyDown={e => { if (e.key === "Enter") { addAction(section.id, e.target.value); e.target.value = ""; } }} />
                      <button onClick={() => { const i = document.getElementById(`new-act-${section.id}`); addAction(section.id, i.value); i.value = ""; }}
                        style={{ background: "#22c55e", border: "none", padding: "9px", borderRadius: 9, color: "white", cursor: "pointer" }}>
                        <Plus size={19} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button onClick={() => setShowSettings(false)} style={{ width: "100%", padding: 14, borderRadius: 14, background: "#3b82f6", color: "white", border: "none", fontWeight: "bold", cursor: "pointer", fontFamily: "inherit" }}>
                حفظ وإغلاق
              </button>
            </div>
          </div>
        )}
      </div>
    </FullScreenWrapper>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// واجهة القسم (المستقبل)
// ══════════════════════════════════════════════════════════════════════════════

const Receiver = ({ title, roomId, icon, color, user, onLogout, isManagerBusy, managerRoomId = 0, managerTitle = "المدير العام" }) => {
  const isMobile = useIsMobile();
  const [notifications, setNotifications] = useState([]);
  const [showModal, setShowModal] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [showCP, setShowCP] = useState(false);
  const [showAgenda, setShowAgenda] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [connected, setConnected] = useState(socket.connected);
  const [effectiveConnected, setEffectiveConnected] = useState(socket.connected);
  // eslint-disable-next-line no-unused-vars
  const [selectedManagerRoomId, setSelectedManagerRoomId] = useState(managerRoomId === null ? 0 : managerRoomId);


  // تحديث الحالة الفعالة لمنع التذبذب البصري
  useEffect(() => {
    if (connected) setEffectiveConnected(true);
    else {
      const t = setTimeout(() => setEffectiveConnected(false), 120000);
      return () => clearTimeout(t);
    }
  }, [connected]);
  const [toast, setToast] = useState({ visible: false, msg: "", type: "info" });
  const [receiverActions, setReceiverActions] = useState({ 0: [], 5: [], 7: [] });
  const [customActionMsgs, setCustomActionMsgs] = useState({});
  const [recordingTargetId, setRecordingTargetId] = useState(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingIntervalRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioRef = useRef(null);
  const [selectedSound, setSelectedSound] = useState(() => localStorage.getItem(`app_sound_${roomId}`) || APP_SOUNDS[0].url);

  const changeSound = (url) => {
    setSelectedSound(url);
    localStorage.setItem(`app_sound_${roomId}`, url);
    socket.emit("update-receiver-settings", { roomId, sound_url: url });

    // تشغيل النغمة للمعاينة بشكل مستقل لضمان عملها
    const previewAudio = new Audio(url);
    previewAudio.play().catch(e => console.error("تعذر تشغيل النغمة:", e));
  };

  const showToast = (msg, type = "info") => {
    setToast({ visible: true, msg, type });
    setTimeout(() => setToast(p => ({ ...p, visible: false })), 3500);
  };

  const authorized = user?.role === "manager" || user?.room_id === roomId;

  // جلب الطلبات المعلقة (المتأخرة أثناء وجود التطبيق في الخلفية)
  const loadReceiverNotifications = useCallback((buster = "") => {
    if (!authorized) return;
    authFetch(`/api/notifications/${roomId}${buster}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setNotifications(prev => {
            const existingIds = new Set(prev.map(n => n.logId || n.id));
            const newNotifs = data.filter(n => !n.completed && !existingIds.has(n.logId || n.id));
            return [...newNotifs, ...prev];
          });
        }
      })
      .catch(console.error);
  }, [roomId, authorized]);

  useEffect(() => {
    if (!authorized) return;

    // تحميل الإعدادات
    authFetch(`/api/receiver-settings/${roomId}`)
      .then(r => r.ok ? r.json() : { actions: [], sound_url: null })
      .then(data => {
        let loaded = data.actions || [];
        if (Array.isArray(loaded)) loaded = { 0: loaded, 5: [], 7: [] };
        setReceiverActions(loaded);
        if (data.sound_url) {
          setSelectedSound(data.sound_url);
          localStorage.setItem(`app_sound_${roomId}`, data.sound_url);
        }
      })
      .catch(console.error);

    const handleNitro = () => {
      console.log(`[RECEIVER LOG] 🚀 نبضة نيترو للغرفة ${roomId}...`);
      loadReceiverNotifications(`?t=${Date.now()}_wake`);

      let count = 0;
      const itv = setInterval(() => {
        loadReceiverNotifications(`?t=${Date.now()}_nitro_${count}`);
        count++;
        if (count >= 10) clearInterval(itv);
      }, 500);
    };

    window.addEventListener('nitro_sync_trigger', handleNitro);
    loadReceiverNotifications();

    return () => {
      window.removeEventListener('nitro_sync_trigger', handleNitro);
      socket.off("connect", loadReceiverNotifications);
    };
  }, [roomId, authorized, loadReceiverNotifications]);

  useEffect(() => {
    if (!authorized) return;
    const onConnect = () => {
      setConnected(true);
      socket.emit("join-room", roomId);
    };
    const onDisconnect = () => setConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    if (socket.connected) {
      socket.emit("join-room", roomId);
    }

    const handleReceive = (data) => {
      setNotifications(prev => {
        if (prev.some(x => x.logId === data.logId)) return prev;
        return [{
          ...data, id: Date.now(), received: false, completed: false,
          time: new Date().toLocaleTimeString("ar-EG"),
        }, ...prev];
      });
      if (audioEnabled && audioRef.current) audioRef.current.play().catch(() => { });

      // إشعار نظام أصلي للقسم
      showNativeNotification(`تنبيه من ${data.fromName || "المدير"}`, data.message);
    };

    socket.on("receive-notification", handleReceive);

    const handleAuthError = (err) => {
      // لا نُسجّل الخروج تلقائياً بسبب خطأ في غرفة Socket
      console.warn("Auth error (socket):", err?.message || err);
    };
    socket.on("auth-error", handleAuthError);


    const handleServerError = ({ message }) => showToast(message || "حدث خطأ غير معروف", "error");
    socket.on("error", handleServerError);

    const handleSettingsUpdate = (data) => {
      if (data.actions) setReceiverActions(data.actions);
      if (data.soundUrl) {
        setSelectedSound(data.soundUrl);
        localStorage.setItem(`app_sound_${roomId}`, data.soundUrl);
      }
    };
    socket.on("receiver-settings-updated", handleSettingsUpdate);

    const handleStatusSync = ({ logId, status }) => {
      // مزامنة حالة الطلب بين الأجهزة (مثلاً إذا استلمت السكرتارية الطلب من هاتفها، يتحدث في الحاسوب أيضاً)
      if (status === "completed") {
        setNotifications(prev => prev.filter(x => String(x.logId || x.id) !== String(logId)));
        if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
      } else if (status === "received") {
        setNotifications(prev => prev.map(x => String(x.logId || x.id) === String(logId) ? { ...x, received: true } : x));
        if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
      }
    };
    socket.on("notification-status-updated", handleStatusSync);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("receive-notification", handleReceive);
      socket.off("auth-error", handleAuthError);
      socket.off("error", handleServerError);
      socket.off("receiver-settings-updated", handleSettingsUpdate);
      socket.off("notification-status-updated", handleStatusSync);
    };
  }, [roomId, audioEnabled, authorized, onLogout]);

  // تكرار تنبيه الصوت للقسم إذا كانت هناك طلبات لم يتم استلامها
  useEffect(() => {
    if (!audioEnabled || !authorized) return;

    const hasUnread = notifications.some(n => !n.received && !n.completed);
    if (!hasUnread) return;

    const interval = setInterval(() => {
      if (audioRef.current) {
        audioRef.current.play().catch(() => { });
      }
    }, 8000); // تكرار كل 8 ثواني

    return () => clearInterval(interval);
  }, [notifications, audioEnabled, authorized]);

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  // عند الضغط على "استلام" → إخطار المدير
  const markReceived = (n) => {
    stopAudio();
    const nid = n.logId || n.id;
    setNotifications(prev => prev.map(x => String(x.logId || x.id) === String(nid) ? { ...x, received: true } : x));
    if (n.logId) socket.emit("update-notification-status", { logId: n.logId, status: "received" });
  };

  // عند الضغط على "إنجاز" → إخطار المدير
  const markCompleted = (n) => {
    stopAudio();
    const nid = n.logId || n.id;
    setNotifications(prev => prev.map(x => String(x.logId || x.id) === String(nid) ? { ...x, completed: true } : x));
    if (n.logId) socket.emit("update-notification-status", { logId: n.logId, status: "completed" });
  };

  const sendToManager = (msg, overrideTargetId = null) => {
    if (isManagerBusy) {
      showToast("عذراً، المدير مشغول حالياً ولا يستقبل أي طلبات ", "error");
      return;
    }
    if (!msg?.trim()) return;
    const finalTargetId = overrideTargetId !== null ? overrideTargetId : managerRoomId;
    socket.emit("send-to-manager", {
      fromRoomId: roomId,
      fromName: title,
      message: msg,
      targetRoomId: finalTargetId,
    });
    setCustomActionMsgs(p => ({ ...p, [finalTargetId]: "" }));
    showToast("تم إرسال الطلب للمدير ✅", "success");
  };

  const toggleRecording = async (overrideTargetId = null) => {
    const finalTargetId = overrideTargetId !== null ? overrideTargetId : managerRoomId;
    if (recordingTargetId === finalTargetId) {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
        if (mediaRecorderRef.current.stream) mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      }
      setRecordingTargetId(null);
    } else {
      if (isManagerBusy) {
        showToast("عذراً، المدير في اجتماع ولا يستقبل أي طلبات حالياً", "error");
        return;
      }
      if (user?.role === 'kitchen') {
        showToast("إرسال البصمات الصوتية غير مفعل لقسم المطبخ حالياً", "info");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        mediaRecorder.onstop = () => {
          clearInterval(recordingIntervalRef.current);
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.readAsDataURL(blob);
          reader.onloadend = () => {
            const base64Audio = reader.result;
            socket.emit("send-to-manager", {
              fromRoomId: roomId, fromName: title,
              message: "بصمة صوتية 🎤", audio: base64Audio, targetRoomId: finalTargetId
            });
            showToast("تم إرسال البصمة للجهة المحددة ✅", "success");
          };
        };

        mediaRecorder.start();
        setRecordingSeconds(0);
        recordingIntervalRef.current = setInterval(() => {
          setRecordingSeconds(p => {
            if (p >= 300) { // 5 minutes limit
              mediaRecorder.stop();
              showToast("انتهى الحد الأقصى للتسجيل (5 دقائق)", "info");
              return p;
            }
            return p + 1;
          });
        }, 1000);
        setRecordingTargetId(finalTargetId);
      } catch { /* microphone access denied */
        showToast("فشل الوصل للميكروفون، يرجى السماح له", "error");
      }

    }
  };

  // eslint-disable-next-line no-unused-vars
  const addReceiverAction = (actionName) => {
    if (!actionName.trim()) return;
    const updated = [...receiverActions, actionName];
    setReceiverActions(updated);
    socket.emit("update-receiver-actions", { roomId, actions: updated });
  };

  // eslint-disable-next-line no-unused-vars
  const removeReceiverAction = (index) => {
    const updated = receiverActions.filter((_, i) => i !== index);
    setReceiverActions(updated);
    socket.emit("update-receiver-actions", { roomId, actions: updated });
  };


  if (!authorized) {
    return (
      <FullScreenWrapper>
        {(!user || !isLoggedIn()) && <Navigate to="/login" replace />}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", minHeight: "100vh", gap: 20, textAlign: "center", padding: 30 }}>
          <div style={{ fontSize: "5rem" }}>🔒</div>
          <h1 style={{ color: "#ef4444", fontSize: "2rem" }}>وصول مرفوض</h1>
          <p style={{ color: "#64748b", fontSize: "1.1rem" }}>ليس لديك صلاحية الوصول إلى هذه الواجهة</p>
          <button onClick={onLogout} style={{ backgroundColor: "#3b82f6", color: "white", border: "none", padding: "14px 30px", borderRadius: 14, cursor: "pointer", fontSize: "1rem", fontWeight: "bold", fontFamily: "inherit" }}>
            تسجيل الخروج والعودة
          </button>
        </div>
      </FullScreenWrapper>
    );
  }

  return (
    <FullScreenWrapper>
      <TopBar user={user} onLogout={onLogout} onChangePassword={() => setShowCP(true)} connected={effectiveConnected} />
      {showCP && <ChangePasswordModal onClose={() => setShowCP(false)} onSuccess={m => showToast(m, "success")} />}
      {showAgenda && <AgendaPanel user={user} onClose={() => setShowAgenda(false)} />}
      {showLogs && <LogsPanel onClose={() => setShowLogs(false)} roomId={roomId} />}
      {showFiles && <FilesPanel user={user} onClose={() => setShowFiles(false)} showToast={showToast} />}

      {/* صوت التنبيه */}
      <audio ref={audioRef} src={selectedSound} preload="auto" />

      <div style={{ width: "100%", padding: isMobile ? "132px 14px 40px" : "90px 5% 40px", boxSizing: "border-box", display: "flex", flexDirection: "column", alignItems: "center" }} dir="rtl">
        <div style={{ width: "100%", maxWidth: 1200 }}>
          <CustomToast visible={toast.visible} message={toast.msg} type={toast.type} />

          {/* نافذة تفعيل الصوت */}
          {showModal && (
            <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(2,6,23,0.98)", zIndex: 10000, display: "flex", justifyContent: "center", alignItems: "center" }}>
              <div style={{ backgroundColor: "#1e293b", padding: isMobile ? "38px" : "55px", borderRadius: 38, textAlign: "center", width: "85%", maxWidth: 480, border: "1px solid #334155" }}>
                <Volume2 size={isMobile ? 65 : 90} color="#3b82f6" style={{ marginBottom: 24 }} />
                <h2 style={{ fontSize: isMobile ? "1.5rem" : "1.9rem", color: "white" }}>تفعيل نظام التنبيه</h2>
                <button onClick={() => {
                  setAudioEnabled(true);
                  setShowModal(false);
                  if ('wakeLock' in navigator) {
                    navigator.wakeLock.request('screen').catch(() => { });
                  }
                  // تفعيل نظام النبض الصامت للقسم لإيقاظ التنبيهات في الخلفية
                  startSilentKeepAlive(() => {
                    performHeartbeat(() => {
                      loadReceiverNotifications();
                    });
                  });


                  const handleVisibility = () => {
                    if (document.visibilityState === "visible") {
                      loadReceiverNotifications();
                      if (!socket.connected) socket.connect();
                      socket.emit("join-room", roomId);
                      if (window.__forceTriggerHeartbeat) window.__forceTriggerHeartbeat();
                    }
                  };
                  document.addEventListener("visibilitychange", handleVisibility);

                  // تفعيل دفع الإشعارات تلقائياً للأقسام
                  if (localStorage.getItem("web_push_enabled") !== "true") {
                    subscribeToPush().catch(console.error);
                  }

                  loadReceiverNotifications();
                }} style={{
                  backgroundColor: "#3b82f6", color: "white", border: "none",
                  padding: isMobile ? "16px 28px" : "22px 45px", borderRadius: 22,
                  fontSize: isMobile ? "1.1rem" : "1.4rem", fontWeight: "bold",
                  cursor: "pointer", width: "100%", marginTop: 24, fontFamily: "inherit",
                }}>
                  تفعيل الآن 🔔
                </button>
              </div>
            </div>
          )}

          {/* رأس الصفحة */}
          <header style={{
            width: "100%", backgroundColor: "#1e293b", padding: isMobile ? "18px" : "26px",
            borderRadius: isMobile ? 22 : 28, display: "flex", justifyContent: "space-between",
            alignItems: "center", marginBottom: 26, border: "1px solid #334155", boxSizing: "border-box", flexWrap: "wrap", gap: 15
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 13, flex: 1, flexWrap: "wrap" }}>
              <div style={{ color, display: "flex" }}>
                {React.cloneElement(icon, { size: isMobile ? 32 : 46 })}
              </div>
              <h1 style={{ fontSize: isMobile ? "1.35rem" : "2.3rem", margin: 0, color: "white" }}>{title}</h1>
              {isManagerBusy && (
                <div style={{ backgroundColor: "#ef4444", color: "white", padding: "6px 14px", borderRadius: 12, fontSize: "0.85rem", fontWeight: "bold", display: "flex", alignItems: "center", gap: 5 }}>
                  <span>⚠️</span>
                  <span> {isMobile ? "المدير مشغول" : "المدير في اجتماع (لا ترسل إلا للضرورة)"} </span>
                </div>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
              <button onClick={() => setShowSettings(true)} style={{ background: "#0f172a", color: "#bfdbfe", border: "1px solid #3b82f6", padding: "10px 16px", borderRadius: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontWeight: "bold", fontFamily: "inherit" }}>
                <Settings size={20} />
                <span style={{ display: isMobile ? "none" : "inline" }}>تخصيص الأزرار</span>
              </button>
              <button onClick={() => setShowLogs(true)} style={{ background: "#1e3a8a", color: "#bfdbfe", border: "1px solid #3b82f6", padding: "10px 16px", borderRadius: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontWeight: "bold", fontFamily: "inherit" }}>
                <History size={20} />
                <span style={{ display: isMobile ? "none" : "inline" }}>سجل الطلبات</span>
              </button>
              {/* زر الملفات يظهر فقط للسكرتارية والمدير */}
              {(user?.role === "secretary" || user?.role === "manager") && (
                <button onClick={() => setShowFiles(true)} style={{ background: "#0f172a", color: "#bfdbfe", border: "1px solid #3b82f6", padding: "10px 16px", borderRadius: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontWeight: "bold", fontFamily: "inherit" }}>
                  <FileText size={20} />
                  <span style={{ display: isMobile ? "none" : "inline" }}>الملفات</span>
                </button>
              )}

              {/* زر جدول الأعمال للسكرتارية */}
              {user?.role === "secretary" && (
                <button onClick={() => setShowAgenda(true)} style={{ background: "#2e1065", color: "#d8b4fe", border: "1px solid #a855f7", padding: "10px 16px", borderRadius: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontWeight: "bold", fontFamily: "inherit" }}>
                  <Calendar size={20} />
                  <span style={{ display: isMobile ? "none" : "inline" }}>جدول أعمال المدير</span>
                </button>
              )}

              <div style={{ fontSize: isMobile ? "1rem" : "1.7rem", fontWeight: "bold", color: "#3b82f6" }}>
                {new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", hour12: true })}
              </div>
            </div>
          </header>

          {/* نافذة تخصيص إعدادات الأقسام */}
          {showSettings && (
            <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(2,6,23,0.96)", zIndex: 10001, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "80px 15px 20px", overflowY: "auto" }}>
              <div style={{ backgroundColor: "#1e293b", width: "100%", maxWidth: 920, borderRadius: 28, padding: 30, border: "1px solid #334155" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <h2 style={{ color: "white", margin: 0 }}>تخصيص الإعدادات للقسم</h2>
                  <X onClick={() => setShowSettings(false)} style={{ cursor: "pointer", color: "#94a3b8" }} />
                </div>

                {/* تخصيص النغمة للقسم */}
                <div style={{ marginBottom: 30, padding: 20, border: "1px solid #334155", borderRadius: 20, backgroundColor: "#0f172a" }}>
                  <h3 style={{ color: "white", marginTop: 0, marginBottom: 18, display: "flex", alignItems: "center", gap: 10 }}>
                    <Volume2 size={24} color="#3b82f6" />
                    نغمة الإشعارات
                  </h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
                    {APP_SOUNDS.map(s => (
                      <button key={s.id} onClick={() => changeSound(s.url)} style={{
                        background: selectedSound === s.url ? "#3b82f6" : "#1e293b",
                        color: selectedSound === s.url ? "white" : "#94a3b8",
                        border: `2px solid ${selectedSound === s.url ? "#3b82f6" : "#334155"}`,
                        padding: "12px", borderRadius: "14px", cursor: "pointer", fontFamily: "inherit", fontWeight: "bold", fontSize: "0.95rem"
                      }}>
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>

                {managerRoomId === null ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16 }}>
                    {[
                      { id: 0, label: "المدير العام" },
                      { id: 5, label: "معاون المدير العام الفني" },
                      { id: 7, label: "معاون المدير العام الاداري" }
                    ].map(target => (
                      <div key={target.id} style={{ marginBottom: 4, padding: 15, border: "1px dashed #334155", borderRadius: 14, backgroundColor: "#0f172a" }}>
                        <h4 style={{ color: "white", marginTop: 0, marginBottom: 10 }}>أزرار السريعة - {target.label}</h4>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginBottom: 15 }}>
                          {(receiverActions[target.id] || []).map((action, index) => (
                            <div key={index} style={{ background: "#1e293b", color: "white", padding: "7px 11px", borderRadius: 9, display: "flex", alignItems: "center", gap: 7 }}>
                              {action}
                              <Trash2 size={13} color="#ef4444" style={{ cursor: "pointer" }} onClick={() => {
                                const newActions = { ...receiverActions, [target.id]: (receiverActions[target.id] || []).filter((_, i) => i !== index) };
                                setReceiverActions(newActions);
                                socket.emit("update-receiver-settings", { roomId, actions: newActions });
                              }} />
                            </div>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 9 }}>
                          <input type="text" id={`new-rec-act-${target.id}`} placeholder={`زر جديد لـ ${target.label}...`} style={{ flex: 1, background: "#1e293b", border: "1px solid #334155", color: "white", padding: "10px", borderRadius: 10, fontFamily: "inherit", outline: "none" }} onKeyDown={e => {
                            if (e.key === "Enter") {
                              const val = e.target.value.trim();
                              if (val) {
                                const newActions = { ...receiverActions, [target.id]: [...(receiverActions[target.id] || []), val] };
                                setReceiverActions(newActions);
                                socket.emit("update-receiver-settings", { roomId, actions: newActions });
                                e.target.value = "";
                              }
                            }
                          }} />
                          <button onClick={() => {
                            const i = document.getElementById(`new-rec-act-${target.id}`);
                            const val = i.value.trim();
                            if (val) {
                              const newActions = { ...receiverActions, [target.id]: [...(receiverActions[target.id] || []), val] };
                              setReceiverActions(newActions);
                              socket.emit("update-receiver-settings", { roomId, actions: newActions });
                              i.value = "";
                            }
                          }} style={{ background: "#22c55e", border: "none", padding: "10px 15px", borderRadius: 10, color: "white", cursor: "pointer" }}><Plus size={19} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ marginBottom: 20 }}>
                    <h3 style={{ color: "white", marginTop: 0, marginBottom: 15 }}>تخصيص الأزرار السريعة للمدير</h3>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginBottom: 20 }}>
                      {(receiverActions[managerRoomId] || []).map((action, index) => (
                        <div key={index} style={{ background: "#0f172a", color: "white", padding: "7px 11px", borderRadius: 9, display: "flex", alignItems: "center", gap: 7 }}>
                          {action}
                          <Trash2 size={13} color="#ef4444" style={{ cursor: "pointer" }} onClick={() => {
                            const newActions = { ...receiverActions, [managerRoomId]: (receiverActions[managerRoomId] || []).filter((_, i) => i !== index) };
                            setReceiverActions(newActions);
                            socket.emit("update-receiver-settings", { roomId, actions: newActions });
                          }} />
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 9, marginBottom: 20 }}>
                      <input type="text" id="new-rec-act" placeholder="اسم الزر الجديد..." style={{ flex: 1, background: "#0f172a", border: "none", color: "white", padding: "10px", borderRadius: 10, fontFamily: "inherit" }} onKeyDown={e => {
                        if (e.key === "Enter") {
                          const val = e.target.value.trim();
                          if (val) {
                            const newActions = { ...receiverActions, [managerRoomId]: [...(receiverActions[managerRoomId] || []), val] };
                            setReceiverActions(newActions);
                            socket.emit("update-receiver-settings", { roomId, actions: newActions });
                            e.target.value = "";
                          }
                        }
                      }} />
                      <button onClick={() => {
                        const i = document.getElementById("new-rec-act");
                        const val = i.value.trim();
                        if (val) {
                          const newActions = { ...receiverActions, [managerRoomId]: [...(receiverActions[managerRoomId] || []), val] };
                          setReceiverActions(newActions);
                          socket.emit("update-receiver-settings", { roomId, actions: newActions });
                          i.value = "";
                        }
                      }} style={{ background: "#22c55e", border: "none", padding: "10px 15px", borderRadius: 10, color: "white", cursor: "pointer" }}><Plus size={19} /></button>
                    </div>
                  </div>
                )}
                <button onClick={() => setShowSettings(false)} style={{ width: "100%", padding: 14, borderRadius: 14, background: "#3b82f6", color: "white", border: "none", fontWeight: "bold", cursor: "pointer", fontFamily: "inherit" }}>إغلاق</button>
              </div>
            </div>
          )}

          {/* واجهة إرسال للمدير */}
          {managerRoomId === null ? (
            <div style={{ width: "100%", marginBottom: 35 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 28, width: "100%" }}>
                {[
                  { id: 0, label: "المدير العام", color: "#3b82f6", icon: <Briefcase size={32} color="#3b82f6" /> },
                  { id: 5, label: "معاون المدير العام الفني", color: "#10b981", icon: <User size={32} color="#10b981" /> },
                  { id: 7, label: "معاون المدير العام الاداري", color: "#f43f5e", icon: <User size={32} color="#f43f5e" /> }
                ].map(target => (
                  <div key={target.id} style={{
                    backgroundColor: "#1e293b", padding: 28, borderRadius: 32,
                    border: "1px solid #334155", boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
                    display: "flex", flexDirection: "column",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 22, borderBottom: `2px solid ${target.color}44`, paddingBottom: 14 }}>
                      <div style={{ display: "flex" }}>{target.icon}</div>
                      <h2 style={{ fontSize: "1.6rem", margin: 0, color: "#fff", fontWeight: 800 }}>{target.label}</h2>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                      {(receiverActions[target.id] || []).map((act, i) => (
                        <button key={i} onClick={() => sendToManager(act, target.id)} style={{
                          backgroundColor: "#0f172a", color: "white", border: "1px solid #334155",
                          padding: "17px 10px", borderRadius: 16, cursor: "pointer", fontWeight: "bold",
                          fontSize: "1rem", transition: "all 0.25s", fontFamily: "inherit",
                        }}
                          onMouseEnter={e => { e.currentTarget.style.backgroundColor = target.color + "22"; e.currentTarget.style.borderColor = target.color; }}
                          onMouseLeave={e => { e.currentTarget.style.backgroundColor = "#0f172a"; e.currentTarget.style.borderColor = "#334155"; }}
                        >
                          {act}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8, backgroundColor: "#0f172a", padding: "8px 12px", borderRadius: 18, border: `1px dashed ${target.color}55`, alignItems: "center", flexWrap: "wrap", marginTop: "auto" }}>
                      {recordingTargetId === target.id ? (
                        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, color: "#ef4444", fontWeight: "bold", fontSize: "1.1rem", padding: "5px" }}>
                          <div style={{ width: 12, height: 12, backgroundColor: "#ef4444", borderRadius: "50%", animation: "pulseDot 1.5s infinite" }} />
                          جاري التسجيل... {Math.floor(recordingSeconds / 60).toString().padStart(2, "0")}:{(recordingSeconds % 60).toString().padStart(2, "0")}
                        </div>
                      ) : (
                        <input type="text" placeholder="نداء مخصص..."
                          value={customActionMsgs[target.id] || ""}
                          onChange={e => setCustomActionMsgs(p => ({ ...p, [target.id]: e.target.value }))}
                          onKeyDown={e => e.key === "Enter" && sendToManager(customActionMsgs[target.id], target.id)}
                          style={{ flex: 1, backgroundColor: "transparent", border: "none", color: "white", padding: "7px", fontSize: "0.95rem", outline: "none", fontFamily: "inherit", minWidth: 100 }} />
                      )}
                      {recordingTargetId !== target.id && (
                        <button onClick={() => sendToManager(customActionMsgs[target.id], target.id)} style={{ backgroundColor: target.color, color: "white", border: "none", borderRadius: 11, padding: "9px 14px", display: "flex", cursor: "pointer", flexShrink: 0 }}>
                          <Send size={16} />
                        </button>
                      )}
                      <button onClick={() => toggleRecording(target.id)} style={{
                        backgroundColor: recordingTargetId === target.id ? "#ef4444" : "#475569", color: "white", border: "none",
                        borderRadius: 11, padding: "9px 14px", display: "flex", cursor: "pointer", transition: "0.2s", flexShrink: 0
                      }} title="تسجيل بصمة صوتية">
                        {recordingTargetId === target.id ? <Square size={16} /> : <Mic size={16} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ backgroundColor: "#1e293b", padding: 25, borderRadius: 28, border: `1px solid ${color}44`, marginBottom: 25 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15, flexWrap: "wrap", gap: 10 }}>
                <h3 style={{ color: "white", margin: 0, fontSize: "1.4rem" }}>
                  إرسال إلى {managerTitle}
                </h3>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 15 }}>
                {(receiverActions[managerRoomId] || []).map((act, i) => (
                  <button key={i} onClick={() => sendToManager(act, managerRoomId)} style={{
                    backgroundColor: "#0f172a", color: "white", border: `1px solid ${color}55`,
                    padding: "12px 20px", borderRadius: 16, cursor: "pointer", fontWeight: "bold",
                    fontSize: "1rem"
                  }}>
                    {act}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, backgroundColor: "#0f172a", padding: "8px 12px", borderRadius: 18, border: `1px dashed ${color}55`, alignItems: "center", flexWrap: "wrap" }}>
                {recordingTargetId === managerRoomId ? (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, color: "#ef4444", fontWeight: "bold", fontSize: "1.1rem", padding: "5px" }}>
                    <div style={{ width: 12, height: 12, backgroundColor: "#ef4444", borderRadius: "50%", animation: "pulseDot 1.5s infinite" }} />
                    جاري التسجيل... {Math.floor(recordingSeconds / 60).toString().padStart(2, "0")}:{(recordingSeconds % 60).toString().padStart(2, "0")}
                  </div>
                ) : (
                  <input type="text" placeholder={`رسالة مخصصة لـ ${managerTitle}...`}
                    value={customActionMsgs[managerRoomId] || ""}
                    onChange={e => setCustomActionMsgs(p => ({ ...p, [managerRoomId]: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && sendToManager(customActionMsgs[managerRoomId], managerRoomId)}
                    style={{ flex: 1, backgroundColor: "transparent", border: "none", color: "white", padding: "7px", fontSize: "0.95rem", outline: "none", fontFamily: "inherit", minWidth: 100 }} />
                )}
                {recordingTargetId !== managerRoomId && (
                  <button onClick={() => sendToManager(customActionMsgs[managerRoomId], managerRoomId)} style={{ backgroundColor: color, color: "white", border: "none", borderRadius: 11, padding: "9px 14px", display: "flex", cursor: "pointer", flexShrink: 0 }}>
                    <Send size={16} />
                  </button>
                )}
                {user?.role !== 'kitchen' && (
                  <button onClick={() => toggleRecording(managerRoomId)} style={{
                    backgroundColor: recordingTargetId === managerRoomId ? "#ef4444" : "#475569", color: "white", border: "none",
                    borderRadius: 11, padding: "9px 14px", display: "flex", cursor: "pointer", transition: "0.2s", flexShrink: 0
                  }} title="تسجيل بصمة صوتية">
                    {recordingTargetId === managerRoomId ? <Square size={16} /> : <Mic size={16} />}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* قائمة الطلبات */}
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 18 }}>
            {notifications.filter(n => !n.completed).length === 0 ? (
              <div style={{ textAlign: "center", padding: "100px 20px" }}>
                <Bell size={isMobile ? 90 : 110} style={{ opacity: 0.07, marginBottom: 16 }} />
                <h3 style={{ fontSize: isMobile ? "1.1rem" : "1.4rem", color: "#475569" }}>لا توجد طلبات واردة حالياً</h3>
              </div>
            ) : notifications.filter(n => !n.completed).map(n => (
              <div key={n.id} style={{
                backgroundColor: "#1e293b", padding: isMobile ? "22px" : "36px",
                borderRadius: isMobile ? 26 : 32,
                display: "flex", flexDirection: isMobile ? "column" : "row",
                justifyContent: "space-between", alignItems: isMobile ? "stretch" : "center",
                borderRight: `${isMobile ? 7 : 11}px solid ${n.received ? "#22c55e" : "#3b82f6"}`,
                boxShadow: "0 12px 35px rgba(0,0,0,0.3)", gap: isMobile ? 20 : 0,
                animation: "slideIn 0.35s ease",
              }}>
                <style>{`@keyframes slideIn{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}}`}</style>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: "0.9rem", color: "#94a3b8" }}>{n.time}</span>
                    <StatusBadge status={n.received ? "received" : "pending"} />
                  </div>
                  <h2 style={{ fontSize: isMobile ? "1.9rem" : "2.8rem", margin: 0, fontWeight: 900, color: "white", marginBottom: n.audio ? 10 : 0 }}>
                    {n.message}
                  </h2>
                  {n.audio && (
                    <audio
                      src={n.audio.startsWith('data:') ? n.audio : `${SERVER_URL}${n.audio}${n.audio.includes('?') ? '&' : '?'}token=${getToken()}`}
                      controls
                      style={{ width: "100%", marginBottom: 15 }}
                    />
                  )}
                </div>
                <div style={{ display: "flex", gap: 13, flexWrap: "wrap" }}>
                  {!n.received && (
                    <button onClick={() => markReceived(n)} style={{
                      backgroundColor: "#3b82f6", color: "white", padding: "12px 18px", borderRadius: 16,
                      border: "none", fontWeight: "bold", flex: 1, fontSize: "1rem", cursor: "pointer", fontFamily: "inherit",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8
                    }}>
                      <span>استلام</span> <span style={{ fontSize: "1.2rem" }}>✋</span>
                    </button>
                  )}
                  <button onClick={() => markCompleted(n)} style={{
                    backgroundColor: "#22c55e", color: "white", padding: "12px 18px", borderRadius: 16,
                    border: "none", fontWeight: "bold", flex: 1, fontSize: "1rem", cursor: "pointer", fontFamily: "inherit",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8
                  }}>
                    <span>إنجاز</span> <span style={{ fontSize: "1.2rem" }}>✅</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </FullScreenWrapper>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// حارس المسار
// ══════════════════════════════════════════════════════════════════════════════
const ProtectedRoute = ({ children, allowedRoles, user }) => {
  if (!user) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate to="/unauthorized" replace />;
  return children;
};

// ══════════════════════════════════════════════════════════════════════════════
// التطبيق الرئيسي
// ══════════════════════════════════════════════════════════════════════════════
function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [isManagerBusy, setIsManagerBusy] = useState(false);

  useEffect(() => {
    socket.on("manager-busy-status", (status) => setIsManagerBusy(status));

    // تسجيل الـ Service Worker لتفعيل ميزات PWA والبقاء في الخلفية (Push Notifications)
    if ('serviceWorker' in navigator) {
      const swPath = (window.location.pathname.startsWith('/smart_system') ? '/smart_system' : '') + '/sw.js';
      navigator.serviceWorker.register(swPath)
        .then(reg => {
          console.log('✅ Service Worker متصل بنجاح:', reg.scope);
          // إذا كان المستخدم مسجلاً دخوله، نحاول تفعيل الـ Push فوراً
          if (isLoggedIn()) {
            requestNotificationPermission();
          }
        })
        .catch(err => console.error('❌ فشل تسجيل Service Worker:', err));
    }

    return () => socket.off("manager-busy-status");
  }, []);


  // التحقق من الـ Token عند بدء التشغيل
  useEffect(() => {
    const initApp = async () => {
      if (isLoggedIn()) {
        const valid = await verifyToken();
        if (valid) {
          setUser(getUser());
          requestNotificationPermission(); // طلب إذن الإشعارات

          // جلب الأقسام لتسمية قسم / مديرية
          try {
            const res = await fetch(`${window.location.origin}${window.location.pathname.startsWith('/smart_system') ? '/smart_system' : ''}/api/sections`, {
              headers: { 'Authorization': `Bearer ${getToken()}` }
            });
            if (res.ok) {
              const secs = await res.json();
              const map = {};
              secs.forEach(s => map[s.id] = s.title);
              window.app_sections_cache = map;
            }
          } catch { /* ignore */ }
        } else {
          clearAuth();
        }
      }
      setChecking(false);
    };
    initApp();

    // 🚀 نظام استيقاظ صاعق (Universal Global Wake-Up)
    const globalWakeUp = () => {
      if (!isLoggedIn()) return;

      const now = new Date().toLocaleTimeString();
      console.log(`[GLOBAL LOG] 🔥 استيقاظ النظام الشامل في: ${now}`);

      // إجبار السوكيت على الاستعادة فوراً
      reconnectSocket();

      // فحص العلامة المعلقة (من الإشعارات) - تحديث بدون إعادة تحميل كاملة للصفحة
      const lastSignal = localStorage.getItem('pending_sync_signal');
      if (lastSignal) {
        const diff = Date.now() - parseInt(lastSignal);
        localStorage.removeItem('pending_sync_signal');
        if (diff < 60000) {
          console.log(`[GLOBAL LOG] 🕵️ كشف إشارة طلب معلق (${diff}ms) -> تحديث بيانات فوري`);
          // تحديث البيانات فقط بدون reload (يمنع ظهور زر تفعيل الصوت من جديد)
          window.dispatchEvent(new Event('nitro_sync_trigger'));
          return;
        }
      }

      // إطلاق نبضات تحديث سريعة لجميع التوريدات
      window.dispatchEvent(new Event('nitro_sync_trigger'));
    };


    const handleReappear = () => {
      if (document.visibilityState === 'visible') globalWakeUp();
    };

    document.addEventListener("visibilitychange", handleReappear);
    window.addEventListener("focus", globalWakeUp);

    return () => {
      document.removeEventListener("visibilitychange", handleReappear);
      window.removeEventListener("focus", globalWakeUp);
    };
  }, []);

  // Heartbeat لإبقاء الوضع أونلاين وإيقاظ التنبيهات (تم نقل المنطق للـ Gloabl)
  // تم توحيد المنطق في الأعلى لضمان الصمت التام وسرعة الجلب

  // مراقبة انتهاء صلاحية الـ Token أو تلقائياً (كل ١٠ دقائق فقط)
  useEffect(() => {
    if (!user) return;
    const checkExpiry = setInterval(async () => {
      const valid = await verifyToken();
      if (!valid) { clearAuth(); setUser(null); socket.disconnect(); }
    }, 10 * 60 * 1000); // كل 10 دقائق (server check)
    return () => clearInterval(checkExpiry);
  }, [user]);


  const handleLogin = (u) => {
    setUser(u);
    requestNotificationPermission();
  };
  const handleLogout = () => { clearAuth(); setUser(null); socket.disconnect(); };

  const defaultRoute = (u) => {
    if (!u) return "/login";
    if (u.role === 'department') return "/department";
    return { manager: "/", secretary: "/secretary", kitchen: "/kitchen", "office-manager": "/office-manager", "deputy-tech": "/", "deputy-admin": "/", "office-tech": "/office-tech", "office-admin": "/office-admin" }[u.role] || "/login";
  };

  if (checking) return (
    <FullScreenWrapper>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", flexDirection: "column", gap: 18 }}>
        <div style={{ width: 46, height: 46, border: "3px solid #334155", borderTopColor: "#3b82f6", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <p style={{ color: "#64748b" }}>جاري التحقق من الجلسة...</p>
      </div>
    </FullScreenWrapper>
  );

  return (
    <Router basename={window.location.pathname.startsWith('/smart_system') ? '/smart_system' : '/'}>
      <Routes>
        <Route path="/login"
          element={user ? <Navigate to={defaultRoute(user)} replace /> : <LoginPage onLogin={handleLogin} />} />

        <Route path="/"
          element={<ProtectedRoute user={user}>
            {user?.role === "manager" || user?.role?.startsWith("deputy-") ? (
              <Manager user={user} onLogout={handleLogout} isManagerBusy={isManagerBusy} />
            ) : (
              <Navigate to={defaultRoute(user)} replace />
            )}
          </ProtectedRoute>} />

        <Route path="/secretary"
          element={<ProtectedRoute allowedRoles={["manager", "secretary"]} user={user}>
            <Receiver title="مكتب السكرتارية" roomId={2} icon={<User />} color="#3b82f6" user={user} onLogout={handleLogout} isManagerBusy={isManagerBusy} />
          </ProtectedRoute>} />

        <Route path="/kitchen"
          element={<ProtectedRoute allowedRoles={["manager", "kitchen"]} user={user}>
            <Receiver title="خدمات المطبخ" roomId={3} icon={<Utensils />} color="#f97316" user={user} onLogout={handleLogout} isManagerBusy={isManagerBusy} />
          </ProtectedRoute>} />

        <Route path="/office-manager"
          element={<ProtectedRoute allowedRoles={["manager", "office-manager"]} user={user}>
            <Receiver title="إدارة المكتب" roomId={4} icon={<ShieldCheck />} color="#a855f7" user={user} onLogout={handleLogout} isManagerBusy={isManagerBusy} />
          </ProtectedRoute>} />

        <Route path="/office-tech"
          element={<ProtectedRoute allowedRoles={["deputy-tech", "office-tech"]} user={user}>
            <Receiver title="إدارة المكتب الخاص بالمعاون الفني" roomId={6} managerRoomId={5} managerTitle="المعاون الفني" icon={<ShieldCheck />} color="#a855f7" user={user} onLogout={handleLogout} isManagerBusy={isManagerBusy} />
          </ProtectedRoute>} />

        <Route path="/office-admin"
          element={<ProtectedRoute allowedRoles={["deputy-admin", "office-admin"]} user={user}>
            <Receiver title="إدارة المكتب الخاص بالمعاون الإداري" roomId={8} managerRoomId={7} managerTitle="المعاون الإداري" icon={<ShieldCheck />} color="#f43f5e" user={user} onLogout={handleLogout} isManagerBusy={isManagerBusy} />
          </ProtectedRoute>} />

        <Route path="/department"
          element={<ProtectedRoute allowedRoles={["department"]} user={user}>
            <Receiver title={window.app_sections_cache?.[user?.room_id] || "قسم / مديرية"} roomId={user?.room_id} icon={<Briefcase />} color="#0ea5e9" managerRoomId={null} managerTitle="الجهات العليا" user={user} onLogout={handleLogout} isManagerBusy={isManagerBusy} />
          </ProtectedRoute>} />

        <Route path="/unauthorized"
          element={<FullScreenWrapper>
            {(!user || !isLoggedIn()) && <Navigate to="/login" replace />}
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", minHeight: "100vh", gap: 20, textAlign: "center", padding: 30 }}>
              <div style={{ fontSize: "5rem" }}>🚫</div>
              <h1 style={{ color: "#ef4444", fontSize: "2rem" }}>وصول غير مصرح</h1>
              <button onClick={handleLogout} style={{ backgroundColor: "#3b82f6", color: "white", border: "none", padding: "14px 30px", borderRadius: 14, cursor: "pointer", fontWeight: "bold", fontFamily: "inherit" }}>تسجيل الخروج</button>
            </div>
          </FullScreenWrapper>} />

        <Route path="*" element={<Navigate to={defaultRoute(user)} replace />} />
      </Routes>
    </Router>
  );
}

export default App;