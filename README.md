# Smart Intercom System

نظام الإنتركوم الذكي للتواصل بين المدير والموظفين.

## طرق التشغيل

### الطريقة الأسهل - ملف Batch (Windows):
```bash
# انقر نقرة مزدوجة على ملف start.bat
start.bat
```

### الطريقة الثانية - PowerShell Script:
```powershell
# انقر نقرة مزدوجة على ملف start.ps1
start.ps1
```

### الطريقة اليدوية - Terminal:
```bash
# في مجلد المشروع الرئيسي
npm run dev
```

### الطريقة التفصيلية:
```bash
# تشغيل السيرفر الخلفي
cd backend
npm start

# في ترمينال آخر، تشغيل الواجهة الأمامية
cd frontend
npm run dev
```

## الروابط

- **لوحة المدير**: http://192.168.100.9:5173/
- **واجهة السكرتير**: http://192.168.100.9:5173/secretary
- **واجهة المطبخ**: http://192.168.100.9:5173/kitchen
- **واجهة مدير المكتب**: http://192.168.100.9:5173/office-manager

## الأوامر المتاحة

- `npm run dev` - تشغيل التطوير (backend + frontend)
- `npm run start` - تشغيل الإنتاج
- `npm run install-all` - تثبيت جميع التبعيات

## المتطلبات

- Node.js
- npm

## الميزات

- اتصال فوري عبر WebSocket
- واجهات جميلة ومتجاوبة
- دعم متعدد الأجهزة
- إشعارات صوتية