export const SERVER_URL = window.location.origin + (window.location.pathname.startsWith('/smart_system') ? '/smart_system' : '');
export const API_BASE = SERVER_URL;
export const LOGO_PATH = SERVER_URL + '/logo.png';
export const getSoundPath = (filename) => `${SERVER_URL}/notification/${filename}`;
// ─── تخزين واسترجاع بيانات المصادقة ─────────────────────────────────────────
export const getToken = () => localStorage.getItem('auth_token');
export const getUser = () => {
    const u = localStorage.getItem('auth_user');
    return u ? JSON.parse(u) : null;
};

export const setAuth = (token, user) => {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user', JSON.stringify(user));
};

export const clearAuth = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
};

export const isLoggedIn = () => !!getToken();

// ─── تسجيل الدخول ────────────────────────────────────────────────────────────
export const login = async (username, password) => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'خطأ في تسجيل الدخول');
    setAuth(data.token, data.user);
    return data;
};

// ─── التحقق من انتهاء صلاحية التوكن محلياً (بدون اتصال بالسيرفر) ──────────────
const isTokenExpiredLocally = () => {
    const token = getToken();
    if (!token) return true;
    try {
        // فكّ الـ Payload بدون التحقق من التوقيع (نستخدمه للوقت فقط)
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (!payload.exp) return false;
        // اعتبره منتهياً فقط إذا تجاوز وقته الحقيقي بـ 60 ثانية احتياطاً
        return Date.now() / 1000 > payload.exp + 60;
    } catch {
        return false; // في حال الخطأ نفترض أنه صالح
    }
};

// ─── التحقق من صحة الـ Token المخزن ─────────────────────────────────────────
export const verifyToken = async () => {
    const token = getToken();
    if (!token) return false;

    // أولاً: فحص محلي سريع لانتهاء الصلاحية
    if (isTokenExpiredLocally()) {
        clearAuth();
        return false;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 ثواني timeout
        const res = await fetch(`${API_BASE}/api/auth/verify`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.status === 401 || res.status === 403) {
            clearAuth();
            return false;
        }
        if (!res.ok) return true; // اعتبره صالحاً مؤقتاً في حال وجود أخطاء أخرى بالسيرفر

        const data = await res.json();
        localStorage.setItem('auth_user', JSON.stringify(data.user));
        return true;
    } catch {
        // في حال فشل الاتصال (Network Error أو Timeout)، نفترض أن التوكن صالح
        // لكي لا يُسجّل الخروج عند تصغير النافذة أو انقطاع الإنترنت المؤقت
        return true;
    }
};


// ─── طلب API مع الـ Token تلقائياً ──────────────────────────────────────────
export const authFetch = async (url, options = {}) => {
    const token = getToken();
    const headers = {
        Authorization: `Bearer ${token}`,
        ...options.headers,
    };

    // إذا لم يكن الجسم FormData، نضبط النوع لـ JSON افتراضياً
    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    return fetch(`${API_BASE}${url}`, {
        cache: 'no-store',
        ...options,
        headers
    });
};

// ─── تغيير كلمة المرور ───────────────────────────────────────────────────────
export const changePassword = async (currentPassword, newPassword) => {
    const res = await authFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'خطأ في تغيير كلمة المرور');
    return data;
};
