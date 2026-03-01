require('dotenv').config();
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
let webpush;
try { webpush = require('web-push'); } catch (e) { webpush = null; }

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ─── إعداد إعدادات التشفير (Encryption) ───────────────────────────────────────
// نستخدم JWT_SECRET كأساس للمفتاح لضمان ثباته
const ENCRYPTION_KEY = crypto.createHash('sha256').update(process.env.JWT_SECRET || 'smart-intercom-super-secret-key-2025').digest();
const IV_LENGTH = 16;

// VAPID keys for Web Push 
const publicVapidKey = process.env.PUBLIC_VAPID_KEY || 'BA6Mkf4MY9gZi2B58Qi_qSG8ubqVgHABy_A1sNILNLltBf7AutX8YO_X32FCnTMlpdPBUJzGFfg9h7WPBW_QzJE';
const privateVapidKey = process.env.PRIVATE_VAPID_KEY || 'jm4FnHVJOMc_8qLhHX59e2gOqUaO8jWbOkYYhz249h8';

if (webpush && publicVapidKey && privateVapidKey) {
  try {
    webpush.setVapidDetails('mailto:admin@smart-intercom.com', publicVapidKey, privateVapidKey);
  } catch (e) {
    console.error("❌ Failed to set VAPID details:", e.message);
  }
}

function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  if (!text || !text.includes(':')) return text;
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (e) {
    return text; // في حال الفشل نرجع النص الأصلي (للملفات القديمة)
  }
}

// ─── إعداد إتصال MySQL ────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'smart_intercom',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  collation: 'utf8mb4_unicode_ci'
});

// ─── محاولة تحميل rate-limit (اختياري) ──────────────────────────────────────
let rateLimit;
try { rateLimit = require('express-rate-limit'); } catch { rateLimit = null; }

// إعداد محدد السرعة لمحاولات الدخول (Brute Force Protection)
const loginLimiter = rateLimit ? rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 10, // 10 محاولات فقط
  message: { error: 'محاولات دخول كثيرة خاطئة، يرجى المحاولة بعد 15 دقيقة' },
  standardHeaders: true,
  legacyHeaders: false,
}) : (req, res, next) => next();

const JWT_SECRET = process.env.JWT_SECRET || 'smart-intercom-super-secret-key-2025';
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  تحذير أمني: يُستخدم JWT_SECRET الافتراضي. يرجى تعيينه في ملف .env في بيئة الإنتاج!');
}
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '365d';
// In cPanel, PORT might be a Unix Socket path, so we don't parseInt it if it doesn't look like a number
const PORT = process.env.PORT || 3000;

const app = express();
app.disable('x-powered-by');

// CORS: السماح فقط من نفس النطاق أو المضيف المحلي
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : null; // null = السماح للجميع (مناسب للشبكة الداخلية)

app.use(cors({
  origin: (origin, callback) => {
    // السماح بالطلبات بدون origin (مثل التطبيقات المحلية)
    if (!origin) return callback(null, true);
    if (!allowedOrigins || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('CORS: النطاق غير مسموح به'));
  },
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));


// ─── Security Headers ────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(self), camera=()');
  next();
});


// Handling subdirectory prefix for all routes (to work with and without /smart_system)
app.use((req, res, next) => {
  if (req.url.startsWith('/smart_system')) {
    req.url = req.url.replace('/smart_system', '') || '/';
  }
  next();
});

// ─── استضافة الواجهة الأمامية (Frontend) ─────────────────────────────────────
// نتحقق من وجود مجلد dist في عدة أماكن لسهولة الرفع
const distPaths = [
  path.join(__dirname, 'dist'),
  path.join(__dirname, '../frontend/dist'),
  path.join(__dirname, 'public'),
  path.join(process.cwd(), 'dist')
];
const frontendDistPath = distPaths.find(p => fs.existsSync(p)) || path.join(__dirname, 'dist');
console.log('📂 Frontend Path:', frontendDistPath);

// ─── إعداد ملف robots.txt لزيادة الموثوقية ─────────────────────────────────────
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send("User-agent: *\nDisallow: /api/\nDisallow: /uploads/\nAllow: /");
});

app.use(express.static(frontendDistPath));
app.use('/smart_system', express.static(frontendDistPath));

// ─── استضافة مجلد الملفات (الصوتيات والمستندات) ──────────────────────────────
const uploadsPath = path.join(__dirname, 'uploads');
const audioDir = path.join(uploadsPath, 'audio');
const docsDir = path.join(uploadsPath, 'docs');

const ensureFolders = () => {
  if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath, { recursive: true });
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
};
ensureFolders();

// ─── حماية مجلد الملفات (الصوتيات والمستندات) ──────────────────────────────
// تم إلغاء الوصول المباشر للمجلدات الحساسة
app.use(['/uploads/docs/*', '/uploads/audio/*'], (req, res, next) => {
  // السماح بالوصول فقط إذا تم التحقق من الهوية
  authenticateToken(req, res, next);
}, (req, res) => {
  const filePath = path.join(__dirname, req.url.replace('/smart_system', ''));
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).redirect('/smart_system/');
  }
});

// منع سرد الملفات أو الدخول للمجلد الرئيسي
app.use('/uploads', (req, res) => {
  res.status(404).redirect('/smart_system/');
});


// app.use('/uploads', express.static(uploadsPath)); // تم إيقاف الوصول المفتوح للأمان

// إعداد multer لرفع الملفات
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, docsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('فقط ملفات PDF أو الصور مسموح بها'));
    }
  }
});

// دالة مساعدة لحفظ الملف الصوتي
const saveAudioFile = (audioData) => {
  if (!audioData || typeof audioData !== 'string' || !audioData.startsWith('data:audio')) return audioData;
  try {
    // Regex robust enough to handle codecs and other params in data URI
    const matches = audioData.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return audioData;
    const buffer = Buffer.from(matches[2], 'base64');
    const extension = matches[1].split('/')[1].split(';')[0] || 'webm';
    const filename = `audio_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`;
    const filePath = path.join(__dirname, 'uploads/audio', filename);
    fs.writeFileSync(filePath, buffer);
    return `/uploads/audio/${filename}`;
  } catch (err) {
    console.error('❌ خطأ في حفظ الملف:', err);
    return audioData;
  }
};

// ─── Rate Limiting على تسجيل الدخول (يمنع Brute Force) ───────────────────────
if (rateLimit) {
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 دقيقة
    max: 10,                   // 10 محاولات فقط كل 15 دقيقة
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'تم تجاوز عدد محاولات تسجيل الدخول. حاول مجدداً بعد 15 دقيقة.' },
  });
  app.use('/api/auth/login', loginLimiter);
  console.log('✅ تم تفعيل Rate Limiting على تسجيل الدخول');
}

// ─── تهيئة قاعدة البيانات MySQL ──────────────────────────────────────────────
// ─── تهيئة قاعدة البيانات MySQL ──────────────────────────────────────────────
async function initDB() {
  const status = [];
  try {
    status.push("بدء تهيئة قاعدة البيانات وإصلاح الترميز...");

    // ضمان استخدام الترميز العربي في الاتصال وقاعدة البيانات
    await pool.query("SET NAMES utf8mb4");
    try {
      await pool.query(`ALTER DATABASE ${process.env.DB_NAME || 'smart_intercom'} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    } catch (e) { console.log("Could not alter database charset, skipping..."); }

    // إنشاء الجداول مع تحديد الترميز صراحة
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sections (
        id INT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        iconName VARCHAR(100) NOT NULL,
        color VARCHAR(50) NOT NULL,
        actions TEXT NOT NULL
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    // تحويل الجداول الموجودة مسبقاً للترميز الصحيح (في حال كانت قديمة)
    const tables = ['sections', 'users', 'notifications_log', 'receiver_settings', 'agenda', 'important_files', 'file_categories'];
    for (const table of tables) {
      try {
        await pool.query(`ALTER TABLE ${table} CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      } catch (e) { /* قد يكون الجدول غير موجود بعد */ }
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        username VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        room_id INT
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications_log (
        id INT PRIMARY KEY AUTO_INCREMENT,
        from_name VARCHAR(255) NOT NULL,
        from_room_id INT,
        to_room_id INT NOT NULL,
        to_section_title VARCHAR(255),
        message TEXT NOT NULL,
        audio TEXT,
        status ENUM('pending', 'received', 'completed') NOT NULL DEFAULT 'pending',
        sent_at VARCHAR(100) NOT NULL,
        received_at VARCHAR(100),
        completed_at VARCHAR(100)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    // محاولة إضافة العمود بطريقة آمنة يدوياً لضمان عدم انهيار السيرفر في حال عدم دعم IF NOT EXISTS
    try {
      await pool.query("ALTER TABLE notifications_log ADD from_room_id INT AFTER from_name");
      status.push("✅ تم تحديث هيكلة جدول التنبيهات");
    } catch (e) {
      // نتجاهل الخطأ إذا كان العمود موجوداً بالفعل (Error 1060)
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS receiver_settings (
        room_id INT PRIMARY KEY,
        actions TEXT NOT NULL,
        sound_url TEXT
      )
    `);
    // ضمان وجود العمود في حال كان الجدول موجوداً مسبقاً بدون إضافة
    try {
      await pool.query("ALTER TABLE receiver_settings ADD sound_url TEXT");
    } catch (e) { /* العمود موجود بالفعل */ }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda (
        id INT PRIMARY KEY AUTO_INCREMENT,
        date VARCHAR(50) NOT NULL,
        time VARCHAR(50) NOT NULL,
        task TEXT NOT NULL,
        is_done TINYINT DEFAULT 0,
        is_cancelled TINYINT DEFAULT 0,
        order_index INT DEFAULT 0,
        created_at VARCHAR(100) NOT NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS important_files (
        id INT PRIMARY KEY AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL DEFAULT 'عام',
        file_path TEXT NOT NULL,
        uploaded_at VARCHAR(100) NOT NULL
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS file_categories (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(100) NOT NULL UNIQUE
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        role VARCHAR(50) NOT NULL,
        subscription TEXT NOT NULL,
        created_at VARCHAR(100) NOT NULL
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    // إدراج تصنيفات افتراضية
    const [catCount] = await pool.query('SELECT COUNT(*) as cnt FROM file_categories');
    if (catCount[0].cnt === 0) {
      await pool.query("INSERT IGNORE INTO file_categories (name) VALUES ('عام'), ('ملفات خارجية'), ('موارد بشرية'), ('تعاميم')");
    }

    // إدراج المستخدمين الافتراضيين
    const defaultUsers = [
      { username: 'manager', password: 'manager123', role: 'manager', room_id: null },
      { username: 'secretary', password: 'sec123', role: 'secretary', room_id: 2 },
      { username: 'kitchen', password: 'kitchen123', role: 'kitchen', room_id: 3 },
      { username: 'office-manager', password: 'office123', role: 'office-manager', room_id: 4 },
      { username: 'deputy-tech', password: 'deputy123', role: 'deputy-tech', room_id: 5 },
      { username: 'office-tech', password: 'officetech123', role: 'office-tech', room_id: 6 },
      { username: 'deputy-admin', password: 'deputy123', role: 'deputy-admin', room_id: 7 },
      { username: 'office-admin', password: 'officeadmin123', role: 'office-admin', room_id: 8 },
      // الأقسام والمديريات الجديدة
      { username: 'commercial', password: 'dep123', role: 'department', room_id: 9 },
      { username: 'legal', password: 'dep123', role: 'department', room_id: 10 },
      { username: 'hr', password: 'dep123', role: 'department', room_id: 11 },
      { username: 'communications', password: 'dep123', role: 'department', room_id: 12 },
      { username: 'properties', password: 'dep123', role: 'department', room_id: 13 },
      { username: 'marine-rescue', password: 'dep123', role: 'department', room_id: 14 },
      { username: 'planning', password: 'dep123', role: 'department', room_id: 15 },
      { username: 'audit', password: 'dep123', role: 'department', room_id: 16 },
      { username: 'joint-ops', password: 'dep123', role: 'department', room_id: 17 },
      { username: 'marine-inspection', password: 'dep123', role: 'department', room_id: 18 },
      { username: 'marine-drilling', password: 'dep123', role: 'department', room_id: 19 },
      { username: 'safety', password: 'dep123', role: 'department', room_id: 20 },
      { username: 'control', password: 'dep123', role: 'department', room_id: 21 },
      { username: 'marine-affairs', password: 'dep123', role: 'department', room_id: 22 },
      { username: 'finance', password: 'dep123', role: 'department', room_id: 23 },
      { username: 'engineering', password: 'dep123', role: 'department', room_id: 24 },
      { username: 'contracts', password: 'dep123', role: 'department', room_id: 25 },
      { username: 'international-code', password: 'dep123', role: 'department', room_id: 26 },
      { username: 'shipyards', password: 'dep123', role: 'department', room_id: 27 },
      { username: 'it', password: 'dep123', role: 'department', room_id: 28 },
      { username: 'dir-nqasr', password: 'dep123', role: 'department', room_id: 29 },
      { username: 'dir-abuflous', password: 'dep123', role: 'department', room_id: 30 },
      { username: 'dir-maqal', password: 'dep123', role: 'department', room_id: 31 },
      { username: 'dir-sqasr', password: 'dep123', role: 'department', room_id: 32 },
      { username: 'inst-ports', password: 'dep123', role: 'department', room_id: 33 },
    ];

    // إصلاح نوع عمود الصلاحيات إذا كان مقيداً بـ ENUM
    try {
      await pool.query("ALTER TABLE users MODIFY COLUMN role VARCHAR(50) NOT NULL");
    } catch (e) { console.log("Could not alter users.role column:", e.message); }

    for (const u of defaultUsers) {
      const [rows] = await pool.query('SELECT id, role FROM users WHERE username = ?', [u.username]);
      if (rows.length === 0) {
        const hashed = bcrypt.hashSync(u.password, 10);
        await pool.query('INSERT INTO users (username, password, role, room_id) VALUES (?, ?, ?, ?)', [u.username, hashed, u.role, u.room_id]);
        status.push(`✅ تم إنشاء المستخدم: ${u.username}`);
      } else if (!rows[0].role || rows[0].role === '' || rows[0].role !== u.role) {
        await pool.query('UPDATE users SET role = ?, room_id = ? WHERE username = ?', [u.role, u.room_id, u.username]);
        status.push(`✅ تم تحديث صلاحيات المستخدم: ${u.username}`);
      }
    }

    // إدراج الأقسام الافتراضية
    const defaultSections = [
      { id: 2, title: 'قسم السكرتارية', iconName: 'User', color: '#3b82f6', actions: JSON.stringify(['استدعاء فوري', 'طلب اجتماع', 'تجهيز أوليات']) },
      { id: 4, title: 'إدارة المكتب', iconName: 'Briefcase', color: '#a855f7', actions: JSON.stringify(['مراجعة البريد', 'جدول المواعيد', 'استقبال ضيوف']) },
      { id: 3, title: 'خدمات المطبخ', iconName: 'Coffee', color: '#f97316', actions: JSON.stringify(['شاي', 'قهوة سادة', 'ماء']) },
      { id: 5, title: 'معاون المدير العام للشؤون الفنية', iconName: 'User', color: '#10b981', actions: JSON.stringify(['طلب حضور', 'ارسال اوليات']) },
      { id: 7, title: 'معاون المدير العام للشؤون الادارية والمالية', iconName: 'User', color: '#f43f5e', actions: JSON.stringify(['طلب حضور', 'ارسال اوليات']) },
      { id: 0, title: 'المدير العام', iconName: 'User', color: '#3b82f6', actions: JSON.stringify(['استئذان دخول', 'يرجى الاطلاع']) },
      { id: 6, title: 'ادارة المكتب الخاص به (فني)', iconName: 'Briefcase', color: '#a855f7', actions: JSON.stringify(['تجهيز أوليات']) },
      { id: 8, title: 'ادارة المكتب الخاص به (اداري)', iconName: 'Briefcase', color: '#f43f5e', actions: JSON.stringify(['تجهيز أوليات']) },
      // الأقسام والمديريات الجديدة
      { id: 9, title: 'القسم التجاري', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 10, title: 'القسم القانوني', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 11, title: 'قسم ادارة الموارد البشرية', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 12, title: 'قسم الاتصالات والرصد البحري', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 13, title: 'قسم الاملاك والأراضي', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 14, title: 'قسم الانقاذ البحري', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 15, title: 'قسم التخطيط والمتابعة', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 16, title: 'قسم التدقيق والرقابة الداخلية', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 17, title: 'قسم التشغيل المشترك', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 18, title: 'قسم التفتيش البحري', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 19, title: 'قسم الحفر البحري', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 20, title: 'قسم السلامة والاطفاء', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 21, title: 'قسم السيطرة والتوجيه البحري', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 22, title: 'قسم الشؤون البحرية', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 23, title: 'قسم الشؤون المالية', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 24, title: 'قسم الشؤون الهندسية', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 25, title: 'قسم العقود', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 26, title: 'قسم المدونة الدولية', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 27, title: 'قسم المسافن', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 28, title: 'قسم تكنولوجيا المعلومات', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 29, title: 'مديرية ام قصر الشمالي', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 30, title: 'مديرية ميناء ابو فلوس', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 31, title: 'مديرية ميناء المعقل', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 32, title: 'مديرية ام قصر الجنوبي', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
      { id: 33, title: 'معهد الموانئ', iconName: 'Briefcase', color: '#0ea5e9', actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) },
    ];

    for (const s of defaultSections) {
      const [rows] = await pool.query('SELECT id FROM sections WHERE id = ?', [s.id]);
      if (rows.length === 0) {
        await pool.query('INSERT INTO sections (id, title, iconName, color, actions) VALUES (?, ?, ?, ?, ?)', [s.id, s.title, s.iconName, s.color, s.actions]);
      }
    }
    status.push('✅ تم فحص وإدراج الأقسام الافتراضية');

    const defaultReceiverSettings = [
      { room_id: 2, actions: JSON.stringify(['استئذان دخول', 'قدوم ضيف', 'مذكرة جاهزة للتوقيع', 'امر طارئ']) },
      { room_id: 4, actions: JSON.stringify(['استئذان دخول', 'ضيف بالانتظار', 'البريد جاهزة للتوقيع', 'امر طارئ']) },
      { room_id: 3, actions: JSON.stringify(['استئذان دخول', 'الطلب جاهز', 'الفطور جاهز', 'الغداء جاهز']) },
      { room_id: 6, actions: JSON.stringify(['استئذان دخول', 'ضيف بالانتظار', 'امر طارئ']) },
      { room_id: 8, actions: JSON.stringify(['استئذان دخول', 'ضيف بالانتظار', 'امر طارئ']) },
      ...Array.from({ length: 25 }, (_, i) => ({ room_id: i + 9, actions: JSON.stringify(['ارسال كتاب', 'اجابة على هامش', 'يرجى الاطلاع']) }))
    ];
    for (const s of defaultReceiverSettings) {
      const [rows] = await pool.query('SELECT room_id FROM receiver_settings WHERE room_id = ?', [s.room_id]);
      if (rows.length === 0) {
        await pool.query('INSERT INTO receiver_settings (room_id, actions) VALUES (?, ?)', [s.room_id, s.actions]);
      }
    }
    status.push('✅ تم فحص وإدراج إعدادات الأزرار الافتراضية');

    status.push('✅ تم تهيئة قاعدة البيانات MySQL بنجاح');
    console.log('✅ DB Init success');
  } catch (err) {
    status.push(`❌ خطأ: ${err.message}`);
    console.error('❌ خطأ في تهيئة قاعدة البيانات:', err);
  }
  return status;
}

// رابط الطوارئ لتهيئة قاعدة البيانات - تم تأمينه ليكون للمدير فقط
app.get('/api/admin/force-setup', authenticateToken, requireManager, async (req, res) => {
  if (req.query.reset === 'true') {
    const tables = ['sections', 'users', 'notifications_log', 'receiver_settings', 'agenda', 'important_files', 'file_categories'];
    for (const t of tables) {
      try { await pool.query(`DROP TABLE IF EXISTS ${t}`); } catch (e) { }
    }
  }
  const result = await initDB();
  res.json({ result: req.query.reset === 'true' ? ["تم مسح الجداول وإعادة تهيئتها بنجاح", ...result] : result });
});

initDB();

// ─── Middlewares ──────────────────────────────────────────────────────────────
async function authenticateToken(req, res, next) {
  let token = '';
  // التحقق من التوكن في الـ Headers
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }
  // دعم التوكن في الرابط (Query string) للتحميل المباشر للملفات
  else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      return res.redirect('/smart_system/');
    }
    return res.status(404).json({ error: 'Not Found' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      if (req.headers.accept && req.headers.accept.includes('text/html')) {
        return res.redirect('/smart_system/');
      }
      return res.status(404).json({ error: 'Not Found' });
    }
    req.user = user;
    next();
  });
}

function requireManager(req, res, next) {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'هذه العملية للمدير فقط' });
  next();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  API Routes
// ═══════════════════════════════════════════════════════════════════════════════

// ─── تسجيل الدخول (مع حماية من التخمين) ──────────────────────────────────
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim() || !password?.trim())
    return res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور' });

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username.trim()]);
    const user = rows[0];

    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, room_id: user.room_id },
      JWT_SECRET, { expiresIn: JWT_EXPIRES }
    );
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, room_id: user.room_id } });
  } catch (error) {
    res.status(500).json({ error: 'خطأ في السيرفر' });
  }
});

// ─── التحقق من الـ Token ──────────────────────────────────────────────────────
app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// ─── Heartbeat لتحديث التواجد ──────────────────────────────────────────────────
// دعم كلاً من طلبات POST العادية و navigator.sendBeacon
app.post('/api/auth/heartbeat', authenticateToken, async (req, res) => {
  try {
    const roomId = req.user.role === 'manager' ? 0 : req.user.room_id;
    if (roomId !== undefined) {
      roomLastSeen.set(roomId, Date.now());

      // في حال كان السيرفر يعتبره أوفلاين، نقوم بتحديث الحالة فوراً (لتقليل التأخير)
      if (!roomReportedOnline.get(roomId)) {
        notifyManagersOfRoomStatus(roomId, true);
      }

      // جلب التنبيهات المعلقة (اختياري للـ Beacon)
      if (req.method === 'POST') {
        const [rows] = await pool.query("SELECT COUNT(*) as cnt FROM notifications_log WHERE to_room_id = ? AND status != 'completed'", [roomId]);
        return res.json({ success: true, pendingCount: rows[0].cnt });
      }
    }
    res.json({ success: true });
  } catch (err) {
    if (req.method === 'POST') res.status(500).json({ error: 'Internal Error' });
  }
});

// ─── إعداد إشعارات الويب (Push Notifications) ──────────────────────────────
app.post('/api/push/subscribe', authenticateToken, async (req, res) => {
  try {
    const subscription = req.body;
    // تطهير: حذف هذا الجهاز من أي حساب آخر مسجل عليه سابقاً لضمان عدم تداخل الإشعارات
    await pool.query('DELETE FROM push_subscriptions WHERE subscription LIKE ?', [`%${subscription.endpoint}%`]);

    await pool.query('INSERT INTO push_subscriptions (user_id, role, subscription, created_at) VALUES (?, ?, ?, ?)', [
      req.user.id,
      req.user.role,
      JSON.stringify(subscription),
      new Date().toLocaleString('ar-EG')
    ]);
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('Push Subscription Error:', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

const sendWebPushNotification = async (targetRoleOrRoomId, payload) => {
  if (!webpush) {
    console.log("⚠️ Web Push library not loaded, skipping push notification.");
    return;
  }
  try {
    let query = '';
    let params = [];

    if (targetRoleOrRoomId === 'manager') {
      query = 'SELECT subscription FROM push_subscriptions WHERE role = "manager"';
    } else if (typeof targetRoleOrRoomId === 'number' || !isNaN(targetRoleOrRoomId)) {
      // استهداف القسم عبر الـ room_id
      query = 'SELECT ps.subscription FROM push_subscriptions ps JOIN users u ON ps.user_id = u.id WHERE u.room_id = ?';
      params = [targetRoleOrRoomId];
    } else {
      return;
    }

    const [rows] = await pool.query(query, params);

    // إثراء الحمولة برقم الغرفة لضمان التصفية الصحيحة في العميل
    const enrichedPayload = {
      ...payload,
      toRoomId: targetRoleOrRoomId === 'manager' ? 0 : parseInt(targetRoleOrRoomId)
    };

    for (const row of rows) {
      try {
        const sub = JSON.parse(row.subscription);
        await webpush.sendNotification(sub, JSON.stringify(enrichedPayload));
      } catch (err) {
        // إذا كان الاشتراك منتهياً، نحذفه
        if (err.statusCode === 410 || err.statusCode === 404) {
          await pool.query('DELETE FROM push_subscriptions WHERE subscription LIKE ?', [`%${JSON.parse(row.subscription).endpoint}%`]);
        }
      }
    }
  } catch (e) {
    console.error('Web Push Send Error:', e);
  }
};

// ─── تغيير كلمة المرور ───────────────────────────────────────────────────────
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'أدخل كلمة المرور الحالية والجديدة' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const user = rows[0];

    if (!bcrypt.compareSync(currentPassword, user.password))
      return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });

    await pool.query('UPDATE users SET password = ? WHERE id = ?', [bcrypt.hashSync(newPassword, 10), req.user.id]);
    res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (error) {
    res.status(500).json({ error: 'خطأ في تحديث البيانات' });
  }
});

// ─── إدارة المستخدمين (المدير فقط) ──────────────────────────────────────────
app.get('/api/users', authenticateToken, requireManager, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, username, role, room_id FROM users');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'خطأ في جلب المستخدمين' });
  }
});

app.put('/api/users/:id/password', authenticateToken, requireManager, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
  try {
    await pool.query('UPDATE users SET password = ? WHERE id = ?', [bcrypt.hashSync(newPassword, 10), req.params.id]);
    res.json({ message: 'تم تحديث كلمة المرور' });
  } catch (error) {
    res.status(500).json({ error: 'خطأ في تحديث البيانات' });
  }
});

// ─── الأقسام ─────────────────────────────────────────────────────────────────
app.get('/api/sections', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM sections');
    res.json(rows.map(s => ({ ...s, actions: JSON.parse(s.actions) })));
  } catch (e) { res.status(500).json({ error: 'خطأ في جلب الأقسام' }); }
});

// ─── إعدادات أزرار الأقسام (Receiver Settings) ────────────────────────────────
app.get('/api/receiver-settings/:roomId', authenticateToken, async (req, res) => {
  try {
    const targetRoom = parseInt(req.params.roomId);
    if (req.user.role !== 'manager' && req.user.room_id !== targetRoom) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const [rows] = await pool.query('SELECT actions, sound_url FROM receiver_settings WHERE room_id = ?', [targetRoom]);
    const row = rows[0];
    res.json({
      actions: row ? JSON.parse(row.actions) : [],
      sound_url: row ? row.sound_url : null
    });
  } catch (e) { res.status(500).json({ error: 'خطأ في جلب الإعدادات' }); }
});

// ─── الطلبات المعلقة للغرفة (للقسم نفسه والمدير) ─────────────────────────
app.get('/api/notifications/:roomId', authenticateToken, async (req, res) => {
  const targetRoom = parseInt(req.params.roomId);

  // التحقق من الصلاحية
  if (req.user.role !== 'manager' && req.user.room_id !== targetRoom) {
    return res.status(403).json({ error: 'غير مصرح للوصول لطلبات هذه الغرفة' });
  }

  try {
    const [pending] = await pool.query(`
      SELECT * FROM notifications_log 
      WHERE to_room_id = ? AND status != 'completed'
      ORDER BY id ASC
    `, [targetRoom]);

    // تنسيق البيانات لتتطابق مع متطلبات الواجهة الأمامية
    const formatted = pending.map(n => ({
      id: n.id,
      logId: n.id,
      fromRoomId: n.from_room_id,
      fromName: n.from_name,
      message: n.message,
      audio: n.audio,
      time: new Date(n.sent_at).toLocaleTimeString("ar-EG"),
      received: n.status === 'received',
      completed: false
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: 'خطأ في جلب الطلبات' });
  }
});

// ─── سجل الطلبات (للمدير فقط) ────────────────────────────────────────────────
app.get('/api/logs', authenticateToken, requireManager, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search || '';
    const date = req.query.date || '';

    let query = 'SELECT * FROM notifications_log WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) as cnt FROM notifications_log WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND (message LIKE ? OR from_name LIKE ? OR to_section_title LIKE ?)';
      countQuery += ' AND (message LIKE ? OR from_name LIKE ? OR to_section_title LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (date) {
      query += ' AND sent_at LIKE ?';
      countQuery += ' AND sent_at LIKE ?';
      params.push(`${date}%`);
    }

    query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    const [logs] = await pool.query(query, [...params, limit, offset]);
    const [countRows] = await pool.query(countQuery, params);
    const total = countRows[0].cnt;

    res.json({ logs, total });
  } catch (e) { res.status(500).json({ error: 'خطأ في جلب السجلات' }); }
});

// ─── سجل الطلبات للقسم نفسه ────────────────────────────────────────────────
app.get('/api/logs/room/:roomId', authenticateToken, async (req, res) => {
  const targetRoom = parseInt(req.params.roomId);
  if (req.user.role !== 'manager' && req.user.room_id !== targetRoom) {
    return res.status(403).json({ error: 'غير مصرح للوصول لسجل هذه الغرفة' });
  }

  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search || '';
    const date = req.query.date || '';

    let query = 'SELECT * FROM notifications_log WHERE (to_room_id = ? OR (from_name = (SELECT title FROM sections WHERE id = ?) AND to_room_id = 0))';
    const params = [targetRoom, targetRoom];

    if (search) {
      query += ' AND (message LIKE ? OR from_name LIKE ? OR to_section_title LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (date) {
      query += ' AND sent_at LIKE ?';
      params.push(`${date}%`);
    }

    query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    const [logs] = await pool.query(query, [...params, limit, offset]);
    res.json({ logs });
  } catch (e) { res.status(500).json({ error: 'خطأ في جلب السجلات' }); }
});

// ─── إحصائيات الطلبات ────────────────────────────────────────────────────────
app.get('/api/stats', authenticateToken, requireManager, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [[{ total }]] = await pool.query("SELECT COUNT(*) as total FROM notifications_log");
    const [[{ todayCount }]] = await pool.query("SELECT COUNT(*) as todayCount FROM notifications_log WHERE sent_at LIKE ?", [`${today}%`]);
    const [[{ pending }]] = await pool.query("SELECT COUNT(*) as pending FROM notifications_log WHERE status='pending'");
    const [[{ received }]] = await pool.query("SELECT COUNT(*) as received FROM notifications_log WHERE status='received'");
    const [[{ completed }]] = await pool.query("SELECT COUNT(*) as completed FROM notifications_log WHERE status='completed'");
    const [bySection] = await pool.query(`
        SELECT to_section_title, COUNT(*) as count
        FROM notifications_log GROUP BY to_section_title ORDER BY count DESC
      `);

    const stats = {
      total,
      today: todayCount,
      pending,
      received,
      completed,
      bySection,
    };
    res.json(stats);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ في جلب الإحصائيات' });
  }
});

// ─── نسخة احتياطية من قاعدة البيانات (للمدير فقط) ──────────────────────────────
app.get('/api/admin/backup', authenticateToken, requireManager, (req, res) => {
  try {
    const dbPath = path.join(__dirname, 'database.sqlite');
    const filename = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
    res.download(dbPath, filename);
  } catch (e) { res.status(500).json({ error: 'خطأ في تصدير النسخة الاحتياطية' }); }
});

// ─── إدارة الملفات المهمة (المدير والسكرتارية) ───────────────────────────────
app.get('/api/files', authenticateToken, async (req, res) => {
  if (req.user.role !== 'manager' && req.user.role !== 'secretary') return res.status(403).json({ error: 'غير مصرح' });
  try {
    const { search, category } = req.query;
    let query = 'SELECT * FROM important_files WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND title LIKE ?';
      params.push(`%${search}%`);
    }

    if (category && category !== 'الكل') {
      query += ' AND category = ?';
      params.push(category);
    }

    query += ' ORDER BY id DESC';
    const [files] = await pool.query(query, params);
    res.json(files);
  } catch (e) { res.status(500).json({ error: 'خطأ في جلب الملفات' }); }
});

app.post('/api/files/upload', authenticateToken, upload.single('file'), async (req, res) => {
  if (req.user.role !== 'secretary') return res.status(403).json({ error: 'غير مصرح - هذه المهمة من اختصاص السكرتارية فقط' });
  if (!req.file) return res.status(400).json({ error: 'لم يتم اختيار ملف' });

  try {
    const title = req.body.title || req.file.originalname;
    const category = req.body.category || 'عام';
    const filePath = `/uploads/docs/${req.file.filename}`;

    // تشفير مسار الملف قبل حفظه في قاعدة البيانات
    const encryptedPath = encrypt(filePath);
    const now = new Date().toISOString();

    await pool.query('INSERT INTO important_files (title, category, file_path, uploaded_at) VALUES (?, ?, ?, ?)', [title, category, encryptedPath, now]);

    res.json({ message: 'تم رفع الملف بتشفير أمني' });
  } catch (e) {
    console.error('❌ خطأ في حفظ بيانات الملف:', e);
    res.status(500).json({ error: 'خطأ في معالجة وتشفير الملف' });
  }
});

// ─── بوابة التحميل الآمنة (Secure Download Gateway) ─────────────────────────
app.get('/api/files/download/:id', authenticateToken, async (req, res) => {
  // التأكد من أن المستخدم مدير أو سكرتارية
  if (req.user.role !== 'manager' && req.user.role !== 'secretary') return res.status(403).json({ error: 'غير مصرح' });

  try {
    const [rows] = await pool.query('SELECT * FROM important_files WHERE id = ?', [req.params.id]);
    const file = rows[0];
    if (!file) return res.status(404).json({ error: 'الملف غير موجود' });

    // فك تشفير المسار لحظياً للتحميل
    const decryptedPath = decrypt(file.file_path);
    const fullPath = path.join(__dirname, decryptedPath);

    if (fs.existsSync(fullPath)) {
      // إجبار المتصفح على تحميل الملف وعدم فتحه لزيادة الخصوصية
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.title)}"`);
      res.sendFile(fullPath);
    } else {
      res.status(404).json({ error: 'الملف المادي مفقود' });
    }
  } catch (e) {
    res.status(500).json({ error: 'خطأ في بوابة التحميل الآمن' });
  }
});

app.delete('/api/files/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'secretary') return res.status(403).json({ error: 'غير مصرح - السكرتارية فقط يمكنها إدارة هذه الملفات' });
  try {
    const [rows] = await pool.query('SELECT file_path FROM important_files WHERE id = ?', [req.params.id]);
    const file = rows[0];
    if (file) {
      const decryptedPath = decrypt(file.file_path);
      const fullPath = path.join(__dirname, decryptedPath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      await pool.query('DELETE FROM important_files WHERE id = ?', [req.params.id]);
    }
    res.json({ message: 'تم حذف الملف بنجاح' });
  } catch (e) { res.status(500).json({ error: 'خطأ في حذف الملف' }); }
});

// ─── إدارة التصنيفات ────────────────────────────────────────────────────────
app.get('/api/categories', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM file_categories');
    res.json(rows.map(r => r.name));
  } catch (e) { res.status(500).json({ error: 'خطأ في جلب التصنيفات' }); }
});

app.post('/api/categories', authenticateToken, async (req, res) => {
  if (req.user.role !== 'secretary' && req.user.role !== 'manager') return res.status(403).json({ error: 'غير مصرح' });
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
    await pool.query('INSERT IGNORE INTO file_categories (name) VALUES (?)', [name]);
    res.json({ message: 'تمت الإضافة بنجاح' });
  } catch (e) { res.status(500).json({ error: 'خطأ في إضافة التصنيف' }); }
});

app.delete('/api/categories/:name', authenticateToken, async (req, res) => {
  if (req.user.role !== 'secretary' && req.user.role !== 'manager') return res.status(403).json({ error: 'غير مصرح' });
  try {
    await pool.query('DELETE FROM file_categories WHERE name = ?', [req.params.name]);
    res.json({ message: 'تم الحذف بنجاح' });
  } catch (e) { res.status(500).json({ error: 'خطأ في حذف التصنيف' }); }
});

// ─── إحصائيات التخزين (للمدير فقط) ──────────────────────────────────────────
app.get('/api/admin/storage-stats', authenticateToken, requireManager, (req, res) => {
  try {
    ensureFolders();
    const files = fs.readdirSync(audioDir);
    let totalSize = 0;
    files.forEach(file => {
      const stats = fs.statSync(path.join(audioDir, file));
      totalSize += stats.size;
    });

    // تحويل الحجم إلى ميجابايت
    const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
    res.json({
      audioFilesCount: files.length,
      totalSizeBytes: totalSize,
      totalSizeMB: sizeMB
    });
  } catch (e) {
    res.status(500).json({ error: 'خطأ في جلب إحصائيات التخزين' });
  }
});

// ─── حذف سجلات قديمة (للمدير فقط) ──────────────────────────────────────────
app.delete('/api/logs', authenticateToken, requireManager, async (req, res) => {
  try {
    const { date } = req.query; // المتوقع YYYY-MM-DD

    if (date) {
      // 1. جلب السجلات التي تحتوي على ملفات صوتية لهذا التاريخ
      const [logsWithAudio] = await pool.query('SELECT audio FROM notifications_log WHERE sent_at LIKE ? AND audio IS NOT NULL', [`${date}%`]);

      // 2. حذف الملفات الفيزيائية
      logsWithAudio.forEach(log => {
        if (log.audio && log.audio.startsWith('/uploads/audio/')) {
          const fileName = log.audio.replace('/uploads/audio/', '');
          const filePath = path.join(audioDir, fileName);
          if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (err) { console.error('Error deleting file:', err); }
          }
        }
      });

      // 3. حذف السجلات من قاعدة البيانات
      const [result] = await pool.query('DELETE FROM notifications_log WHERE sent_at LIKE ?', [`${date}%`]);
      res.json({ message: `تم حذف ${result.affectedRows} سجل لليوم المحدد بنجاح` });

    } else {
      // الحذف الشامل
      await pool.query('DELETE FROM notifications_log');
      if (fs.existsSync(audioDir)) {
        const files = fs.readdirSync(audioDir);
        files.forEach(file => {
          try { fs.unlinkSync(path.join(audioDir, file)); } catch (err) { }
        });
      }
      res.json({ message: 'تم مسح جميع السجلات والملفات الصوتية بنجاح' });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'حدث خطأ أثناء محاولة الحذف' });
  }
});

// ─── جدول الأعمال (Agenda) ────────────────────────────────────────────────────
app.get('/api/agenda/range', authenticateToken, async (req, res) => {
  if (req.user.role !== 'manager' && req.user.role !== 'secretary') return res.status(403).json({ error: 'غير مصرح' });
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'يرجى تحديد فترة معينة' });
  try {
    const [items] = await pool.query('SELECT * FROM agenda WHERE date >= ? AND date <= ? ORDER BY date ASC, order_index ASC, time ASC', [start, end]);
    res.json(items);
  } catch (e) { res.status(500).json({ error: 'خطأ في جلب الجدول' }); }
});

app.get('/api/agenda/:date', authenticateToken, async (req, res) => {
  if (req.user.role !== 'manager' && req.user.role !== 'secretary') return res.status(403).json({ error: 'غير مصرح' });
  try {
    const [items] = await pool.query('SELECT * FROM agenda WHERE date = ? ORDER BY order_index ASC, time ASC', [req.params.date]);
    res.json(items);
  } catch (e) { res.status(500).json({ error: 'خطأ في جلب الجدول' }); }
});

app.post('/api/agenda', authenticateToken, async (req, res) => {
  if (req.user.role !== 'secretary') return res.status(403).json({ error: 'فقط السكرتارية يمكنها إضافة جدول' });
  try {
    const { date, time, task } = req.body;
    if (!date || !time || !task) return res.status(400).json({ error: 'بيانات غير مكتملة' });
    const [result] = await pool.query('INSERT INTO agenda (date, time, task, created_at) VALUES (?, ?, ?, ?)', [date, time, task, new Date().toISOString()]);
    const newItem = { id: result.insertId, date, time, task, is_done: 0, is_cancelled: 0 };
    res.json(newItem);
  } catch (e) { res.status(500).json({ error: 'خطأ في الإضافة' }); }
});

app.put('/api/agenda/reorder', authenticateToken, async (req, res) => {
  if (req.user.role !== 'secretary') return res.status(403).json({ error: 'غير مصرح' });
  try {
    const { orderedIds } = req.body;
    for (let i = 0; i < orderedIds.length; i++) {
      await pool.query('UPDATE agenda SET order_index = ? WHERE id = ?', [i, orderedIds[i]]);
    }
    res.json({ message: 'تم حفظ الترتيب' });
  } catch (e) { res.status(500).json({ error: 'خطأ في حفظ الترتيب' }); }
});

app.put('/api/agenda/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'manager' && req.user.role !== 'secretary') return res.status(403).json({ error: 'غير مصرح' });
  try {
    const { is_done, is_cancelled, task, time } = req.body;
    let updates = [];
    let values = [];

    if (is_done !== undefined) {
      updates.push('is_done = ?');
      values.push(is_done ? 1 : 0);
    }
    if (is_cancelled !== undefined && req.user.role === 'secretary') {
      updates.push('is_cancelled = ?');
      values.push(is_cancelled ? 1 : 0);
    }
    if (task !== undefined && req.user.role === 'secretary') {
      updates.push('task = ?');
      values.push(task);
    }
    if (time !== undefined && req.user.role === 'secretary') {
      updates.push('time = ?');
      values.push(time);
    }

    if (updates.length > 0) {
      values.push(req.params.id);
      await pool.query(`UPDATE agenda SET ${updates.join(', ')} WHERE id = ?`, values);
    }
    res.json({ message: 'تم التحديث' });
  } catch (e) { res.status(500).json({ error: 'خطأ في التحديث' }); }
});

app.delete('/api/agenda/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'secretary') return res.status(403).json({ error: 'غير مصرح' });
  try {
    await pool.query('DELETE FROM agenda WHERE id = ?', [req.params.id]);
    res.json({ message: 'تم الحذف' });
  } catch (e) { res.status(500).json({ error: 'خطأ في الحذف' }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Socket.IO
// ═══════════════════════════════════════════════════════════════════════════════
const server = http.createServer(app);

const io = new Server(server, {
  path: '/smart_system/socket.io',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingInterval: 10000,
  pingTimeout: 300000,
});

// التحقق من الـ Token عند الاتصال
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('AUTH_REQUIRED'));
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return next(new Error(err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID'));
    socket.user = user;
    next();
  });
});

// خريطة: roomId → Set of socket IDs (لمعرفة من هو متصل)
const roomMembers = new Map();
// خريطة: roomId → Timestamp (آخر ظهور عبر HTTP أو Socket)
const roomLastSeen = new Map();
// خريطة: roomId → Boolean (الحالة الحالية المبلغ عنها للمدراء لتجنب التكرار)
const roomReportedOnline = new Map();
let isManagerBusy = false;

io.on('connection', (socket) => {
  const roomId = socket.user.role === 'manager' ? 0 : socket.user.room_id;
  console.log(`✅ [${new Date().toLocaleTimeString('ar-EG')}] متصل: ${socket.user.username} (Room: ${roomId})`);

  // تحديث التواجد فور الاتصال
  if (roomId !== undefined && roomId !== null) roomLastSeen.set(roomId, Date.now());
  // إشعار المدراء فوراً (بدون انتظار join-room) أن الغرفة متصلة
  if (roomId !== undefined && roomId !== null && roomId !== 0) {
    notifyManagersOfRoomStatus(roomId, true);
  }

  // تحديث التواجد عند أي رسالة من السوكيت
  socket.onAny(() => {
    if (roomId !== undefined && roomId !== null) roomLastSeen.set(roomId, Date.now());
  });


  // المدير والمعاونون ينضمون لغرفة الإدارة لاستقبال تحديثات حالة الغرف
  const isManagementUser = ['manager', 'deputy-tech', 'deputy-admin'].includes(socket.user.role);
  if (isManagementUser) {
    socket.join('manager_room');
  }


  socket.emit('manager-busy-status', isManagerBusy);

  // إرسال حالة جميع الغرف للمدير والمعاونين فور الاتصال
  if (isManagementUser) {
    const currentStatuses = {};
    roomLastSeen.forEach((lastSeen, rId) => {
      const isRecentlySeen = (Date.now() - lastSeen) < 305000;
      const hasSockets = roomMembers.has(rId) && roomMembers.get(rId).size > 0;
      if (isRecentlySeen || hasSockets) {
        currentStatuses[rId] = true;
      }
    });
    socket.emit('all-room-statuses', currentStatuses);
  }


  socket.on('set-manager-busy', (status) => {
    if (socket.user.role === 'manager') {
      isManagerBusy = status;
      io.emit('manager-busy-status', status);
    }
  });

  // ─── الانضمام لغرفة ────────────────────────────────────────────────────────
  socket.on('join-room', (roomId) => {
    const role = socket.user.role;
    const userRoomId = Number(socket.user.room_id);
    const reqRoom = Number(roomId);

    // تحديد الغرف المسموح بها لكل دور
    let allowedRooms;
    if (role === 'manager') {
      allowedRooms = null; // المدير يدخل أي غرفة
    } else if (role === 'deputy-tech') {
      allowedRooms = [0, 5, 6]; // غرفة الإدارة + غرفته + مكتبه
    } else if (role === 'deputy-admin') {
      allowedRooms = [0, 7, 8]; // غرفة الإدارة + غرفته + مكتبه
    } else if (role === 'office-tech') {
      allowedRooms = [6]; // مكتبه فقط
    } else if (role === 'office-admin') {
      allowedRooms = [8]; // مكتبه فقط
    } else {
      allowedRooms = [userRoomId]; // باقي الأدوار: غرفتهم فقط
    }

    const isAllowed = allowedRooms === null || allowedRooms.includes(reqRoom);

    if (!isAllowed) {
      console.warn(`⚠️  غير مصرح: ${socket.user.username} (${role}) حاول دخول غرفة ${reqRoom}`);
      // لا نُجبر تسجيل الخروج – خطأ غرفة لا يعني خطراً أمنياً
      return;
    }
    socket.join(roomId);
    if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Set());
    roomMembers.get(roomId).add(socket.id);
    roomLastSeen.set(roomId, Date.now());
    console.log(`   ${socket.user.username} (${role}) انضم لغرفة ${roomId}`);

    // إرسال حالة الاتصال للمدراء
    notifyManagersOfRoomStatus(roomId, true);
  });


  // ─── إرسال طلب (المدير فقط) ────────────────────────────────────────────────
  socket.on('send-notification', async (data) => {
    if (socket.user.role !== 'manager' && !socket.user.role.startsWith('deputy-')) {
      socket.emit('auth-error', { message: 'إرسال الطلبات للمسؤولين فقط' });
      return;
    }
    try {
      const sentAt = new Date().toISOString();
      const message = data.message || '';
      const sectionTitle = data.sectionTitle || '';
      const fromName = data.fromName || 'المدير';

      let audio = data.audio || null;
      if (audio) audio = saveAudioFile(audio);

      // حفظ في قاعدة البيانات
      const [result] = await pool.query(`
        INSERT INTO notifications_log (from_name, from_room_id, to_room_id, to_section_title, message, audio, status, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
      `, [fromName, socket.user.role === 'manager' ? 0 : socket.user.room_id, data.toRoomId, sectionTitle, message, audio, sentAt]);

      const logId = result.insertId;
      const payload = { ...data, message, sectionTitle, fromName, logId, sentAt, audio };

      // إرسال للقسم المحدد
      if (data.toRoomId === 0) {
        io.to('manager_room').emit('receive-manager-notification', payload);
      } else {
        io.to(data.toRoomId).emit('receive-notification', payload);
      }

      // إرسال Web Push للقسم (للهواتف المغلقة)
      sendWebPushNotification(data.toRoomId, {
        title: `تنبيه من ${fromName || "المدير"}`,
        body: message,
        icon: '/logo.png',
        url: `/smart_system/${sectionTitle === 'مدير المكتب' ? 'office-manager' : sectionTitle === 'خدمات المطبخ' ? 'kitchen' : 'secretary'}`,
        toRoomId: data.toRoomId
      });

      // إخبار جميع المدراء بنجاح الإرسال + الـ ID للتتبع لتحديث شعار الـ Loading لديهم جميعاً
      io.to('manager_room').emit('notification-sent', { logId, message: payload.message });
    } catch (e) {
      console.error('خطأ في إرسال الطلب:', e);
      socket.emit('error', { message: 'حدث خطأ في السيرفر أثناء إرسال الطلب' });
    }
  });

  // ─── تحديث حالة الطلب (القسم يُخبر المدير) ────────────────────────────────
  socket.on('update-notification-status', async (data) => {
    const { logId, status } = data;
    if (!logId || !['received', 'completed'].includes(status)) return;

    try {
      const now = new Date().toISOString();
      const field = status === 'received' ? 'received_at' : 'completed_at';

      // تحديث في قاعدة البيانات
      await pool.query(`UPDATE notifications_log SET status = ?, ${field} = ? WHERE id = ?`, [status, now, logId]);

      // إخطار المدير بالتحديث
      const statusUpdate = {
        logId,
        status,
        updatedAt: now,
        sectionTitle: socket.user.username,
        roomId: socket.user.room_id,
      };
      io.emit('notification-status-updated', statusUpdate);
    } catch (e) {
      console.error('خطأ في تحديث حالة الطلب:', e);
    }
  });

  // ─── تحديث الأقسام (المدير فقط) ────────────────────────────────────────────
  socket.on('update-sections', async (sections) => {
    if (socket.user.role !== 'manager') {
      socket.emit('auth-error', { message: 'تعديل الأقسام للمدير فقط' });
      return;
    }
    try {
      // استخدام عملية واحدة لضمان استمرارية البيانات (Atomic update)
      // بدلاً من حذف الكل، نقوم بتحديث الموجود وحذف غير الموجود
      const incomingIds = sections.map(s => s.id);

      // حذف الأقسام غير الموجودة في القائمة الجديدة
      if (incomingIds.length > 0) {
        await pool.query('DELETE FROM sections WHERE id NOT IN (?)', [incomingIds]);
      }

      for (const s of sections) {
        await pool.query(
          'INSERT INTO sections (id, title, iconName, color, actions) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE title = ?, iconName = ?, color = ?, actions = ?',
          [s.id, s.title, s.iconName, s.color, JSON.stringify(s.actions), s.title, s.iconName, s.color, JSON.stringify(s.actions)]
        );
      }

      io.emit('sections-updated', sections);
      console.log('✅ تم تحديث الأقسام بنجاح');
    } catch (e) {
      console.error('❌ خطأ في تحديث الأقسام:', e);
      socket.emit('error', { message: 'فشل في حفظ تحديثات الأقسام' });
    }
  });

  // ─── تخصيص إعدادات الأقسام (المرسل والمستقبل) ───────────────────────────
  // معالجة الحدثين لضمان الحفظ من أي واجهة (الإعدادات أو الواجهة الرئيسية)
  const handleReceiverSettingsUpdate = async (data) => {
    if (socket.user.role !== 'manager' && socket.user.room_id !== data.roomId) return;
    try {
      const roomId = parseInt(data.roomId);

      if (data.actions) {
        // تحديث الأزرار فقط مع الحفاظ على البيانات الأخرى
        await pool.query(
          'INSERT INTO receiver_settings (room_id, actions) VALUES (?, ?) ON DUPLICATE KEY UPDATE actions = ?',
          [roomId, JSON.stringify(data.actions), JSON.stringify(data.actions)]
        );
      }

      const soundUrl = data.sound_url || data.soundUrl;
      if (soundUrl) {
        // تحديث النغمة فقط مع الحفاظ على الأزرار
        await pool.query(
          'INSERT INTO receiver_settings (room_id, actions, sound_url) VALUES (?, "[]", ?) ON DUPLICATE KEY UPDATE sound_url = ?',
          [roomId, soundUrl, soundUrl]
        );
      }

      // جلب البيانات النهائية بعد التحديث لضمان المزامنة
      const [rows] = await pool.query('SELECT actions, sound_url FROM receiver_settings WHERE room_id = ?', [roomId]);
      if (rows.length > 0) {
        const payload = {
          roomId: roomId,
          actions: JSON.parse(rows[0].actions),
          soundUrl: rows[0].sound_url
        };
        io.to(roomId).emit('receiver-settings-updated', payload);
        // إخطار المدير أيضاً إذا كان هو من قام بالتعديل
        if (socket.user.role === 'manager') {
          io.to('manager_room').emit('receiver-settings-updated', payload);
        }
      }
    } catch (e) {
      console.error('❌ خطأ في تحديث إعدادات القسم:', e);
      socket.emit('error', { message: 'فشل في حفظ التعديلات' });
    }
  };

  socket.on('update-receiver-settings', handleReceiverSettingsUpdate);
  socket.on('update-receiver-actions', handleReceiverSettingsUpdate);

  // ─── إرسال طلب من قسم إلى المدير ───────────────────────────────────────────
  socket.on('send-to-manager', async (data) => {
    if (isManagerBusy) {
      socket.emit('error', { message: 'المدير في اجتماع ولا يستقبل طلبات حالياً' });
      return;
    }
    try {
      const sentAt = new Date().toISOString();
      const message = data.message || '';
      const fromName = data.fromName || socket.user.username;

      let audio = data.audio || null;
      if (audio) audio = saveAudioFile(audio);

      const targetRoomId = data.targetRoomId !== undefined ? data.targetRoomId : 0;

      // 0 يمثل المدير العام، وغيره يمثل المعاونين
      const [result] = await pool.query(`
        INSERT INTO notifications_log (from_name, from_room_id, to_room_id, to_section_title, message, audio, status, sent_at)
        VALUES (?, ?, ?, 'المدير', ?, ?, 'pending', ?)
      `, [fromName, data.fromRoomId || socket.user.room_id, targetRoomId, message, audio, sentAt]);

      const logId = result.insertId;
      const payload = { ...data, message, fromName, logId, sentAt, audio, toRoomId: targetRoomId };

      // إرسال للمدراء
      if (targetRoomId === 0) {
        io.to('manager_room').emit('receive-manager-notification', payload);
      } else {
        io.to(targetRoomId).emit('receive-manager-notification', payload);
      }

      // إرسال Web Push للمديرين (للهواتف المغلقة)
      if (targetRoomId === 0) {
        sendWebPushNotification('manager', {
          title: `طلب جديد من ${fromName}`,
          body: message,
          icon: '/logo.png',
          url: '/smart_system/',
          toRoomId: 0
        });
      }

      // إخبار جميع الأجهزة في نفس القسم (مثلاً إذا أرسل من الهاتف يظهر في الحاسوب)
      if (socket.user.room_id) {
        io.to(socket.user.room_id).emit('notification-sent', { logId, message: payload.message });
      } else {
        socket.emit('notification-sent', { logId, message: payload.message });
      }
    } catch (e) {
      console.error('خطأ في إرسال الطلب للمدير:', e);
      socket.emit('error', { message: 'حدث خطأ أثناء إرسال الطلب للمدير' });
    }
  });

  // ─── إشعار بتحديث جدول الأعمال ──────────────────────────────────────────────
  socket.on('agenda-updated', (date) => {
    io.emit('refresh-agenda', date);
  });

  // ─── قطع الاتصال ───────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`❌ [${new Date().toLocaleTimeString('ar-EG')}] قطع الاتصال: ${socket.user?.username}`);

    roomMembers.forEach((members, rId) => {
      if (members.delete(socket.id) && members.size === 0) {
        // فترة سماح قصيرة (8 ثواني) لتسمح لإعادة الاتصال التلقائي (مثلاً عند تبديل الشبكة)
        // بعد الفترة إذا لم يعد أحد → نحوّله offline فوراً بدلاً من الانتظار 15 دقيقة
        setTimeout(() => {
          const stillEmpty = !roomMembers.has(rId) || roomMembers.get(rId).size === 0;
          if (stillEmpty) {
            console.log(`📴 [Room ${rId}] أصبح غير متصل`);
            // حذف آخر وقت ظهور لمنع نظام Audit من اعتباره متصلاً
            roomLastSeen.delete(rId);
            notifyManagersOfRoomStatus(rId, false);
          }
        }, 8000); // 8 ثوان فترة سماح
      }
    });
  });
});


// ─── إعادة توجيه كل المسارات غير الموجودة في API إلى الواجهة الأمامية ───────────
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

// إرسال حالة الغرفة للمدراء (متصل/غير متصل) مع تجنب التكرار
function notifyManagersOfRoomStatus(roomId, isOnline) {
  if (roomReportedOnline.get(roomId) === isOnline) return; // لا نرسل إذا لم تتغير الحالة
  roomReportedOnline.set(roomId, isOnline);
  io.to('manager_room').emit('room-status', { roomId, isOnline });
}

// نظام تدقيق التواجد الدوري (Audit) - صامد لمواجهة نوم الهواتف
setInterval(() => {
  const now = Date.now();
  roomLastSeen.forEach((lastSeen, roomId) => {
    const hasSockets = roomMembers.has(roomId) && roomMembers.get(roomId).size > 0;
    // زيادة المدة لـ 15 دقيقة لضمان عدم التحول لـ Offline أثناء سكون الهاتف أو تغطية النافذة
    const isRecentlySeen = (now - lastSeen) < 900000;

    const isCurrentlyOnline = hasSockets || isRecentlySeen;
    notifyManagersOfRoomStatus(roomId, isCurrentlyOnline);

    // تنظيف الغرف الخاملة جداً (يوم كامل)
    if (!isCurrentlyOnline && (now - lastSeen) > 86400000) {
      roomLastSeen.delete(roomId);
      roomReportedOnline.delete(roomId);
    }
  });
}, 60000); // تدقيق كل دقيقة لتقليل الضغط

// ─── Global Error Handler (Hiding Internal Paths) ──────────────────────────
app.use((err, req, res, next) => {
  console.error('SERVER_ERROR:', err.message);

  // إذا كان المستخدم يفتح الرابط في المتصفح، نحوله للرئيسية بدلاً من إظهار خطأ
  if (req.headers.accept && req.headers.accept.includes('text/html')) {
    return res.redirect('/smart_system/');
  }

  // لطلبات الـ API نكتفي بـ 404 للتمويه
  res.status(404).json({ error: 'Not Found' });
});

// ─── تشغيل السيرفر ────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  let ip = 'localhost';
  for (const name of Object.keys(os.networkInterfaces())) {
    for (const iface of os.networkInterfaces()[name]) {
      if (iface.family === 'IPv4' && !iface.internal) { ip = iface.address; break; }
    }
  }
  console.log(`\n🚀 السيرفر يعمل على:`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://${ip}:${PORT}`);

});