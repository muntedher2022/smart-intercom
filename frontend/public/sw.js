/* eslint-disable no-restricted-globals */
const channel = new BroadcastChannel('smart_intercom_sync');
let currentRoomId = null;

// استقبال الهوية والتوكن من التطبيق
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SET_ROOM_ID') {
        currentRoomId = event.data.roomId;
        console.log(`[SW LOG] هوية الغرفة مسجلة الآن: ${currentRoomId}`);
    }
});

self.addEventListener('push', function (event) {
    const now = new Date().toLocaleTimeString();
    console.log(`[SW LOG] 📥 استلمت إشعار دفع في الوقت: ${now}`);

    let data = { title: 'تنبيه جديد', body: 'لديك طلب جديد', toRoomId: null };
    if (event.data) {
        try { data = event.data.json(); } catch (e) { data.body = event.data.text(); }
    }

    if (data.toRoomId !== null && currentRoomId !== null && data.toRoomId != currentRoomId) {
        console.log(`[SW LOG] ⚠️ تم تجاهل الإشعار: موجه للغرفة ${data.toRoomId} والنشطة هي ${currentRoomId}`);
        return;
    }

    // إرسال الإشارة للقناة المفتوحة
    console.log(`[SW LOG] 🚀 إرسال إشارة SYNC للنافذة...`);
    channel.postMessage({
        type: 'SYNC_NOW',
        toRoomId: data.toRoomId,
        timestamp: Date.now()
    });

    const options = {
        body: data.body,
        icon: '/logo.png',
        badge: '/logo.png',
        vibrate: [200, 100, 200, 100, 200, 100, 400],
        data: { url: data.url || '/smart_system/' },
        tag: 'smart-intercom-' + (data.toRoomId || 'general'),
        renotify: true,
        requireInteraction: true
    };

    event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', function (event) {
    console.log(`[SW LOG] 🖱️ تم النقر على الإشعار`);
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
            for (var i = 0; i < clientList.length; i++) {
                var client = clientList[i];
                if (client.url.includes('/smart_system/') && 'focus' in client) {
                    client.postMessage({ type: 'FORCE_RELOAD', time: Date.now() });
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(event.notification.data.url);
        })
    );
});
