import { io } from 'socket.io-client';
import { getToken } from './auth';

import { SERVER_URL } from './auth';
// إنشاء socket مع إرسال الـ token للمصادقة
export const createSocket = () => {
    const token = getToken();
    const isSubdir = window.location.pathname.startsWith('/smart_system');

    return io(window.location.origin, {
        path: isSubdir ? '/smart_system/socket.io' : '/socket.io',
        // نستخدم polling أولاً كأولوية قصوى لأنه الأسرع في الاستيقاظ من الخلفية
        transports: ['polling', 'websocket'],
        upgrade: true, // ترقية الاتصال لـ websocket لاحقاً بهدوء
        reconnection: true,
        reconnectionDelay: 200, // تقليل وقت الانتظار جداً
        reconnectionDelayMax: 1000,
        reconnectionAttempts: Infinity,
        timeout: 10000,
        auth: { token },
    });
};

// Socket افتراضي (سيتم تحديثه بعد تسجيل الدخول)
export let socket = createSocket();

export const reconnectSocket = () => {
    if (socket) {
        socket.disconnect();
        // نحدث بيانات المصادقة في حال تغير التوكن
        socket.auth = { token: getToken() };
        socket.connect();
    }
    return socket;
};

socket.on('connect', () => {
    console.log('✅ متصل بالسيرفر في:', SERVER_URL);
});

socket.on('disconnect', () => {
    console.log('❌ قطع الاتصال بالسيرفر');
});

socket.on('connect_error', (error) => {
    console.error('❌ خطأ في الاتصال:', error.message);
});