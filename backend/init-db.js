require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function init() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'smart_intercom',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  try {
    console.log("⏳ جاري تهيئة قاعدة البيانات MySQL...");

    // إنشاء الجداول
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sections (
        id INT PRIMARY KEY,
        title TEXT NOT NULL,
        iconName TEXT NOT NULL,
        color TEXT NOT NULL,
        actions TEXT NOT NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        username VARCHAR(255) NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role VARCHAR(50) NOT NULL,
        room_id INT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications_log (
        id INT PRIMARY KEY AUTO_INCREMENT,
        from_name TEXT NOT NULL,
        to_room_id INT NOT NULL,
        to_section_title TEXT,
        message TEXT NOT NULL,
        audio TEXT,
        status ENUM('pending', 'received', 'completed') NOT NULL DEFAULT 'pending',
        sent_at TEXT NOT NULL,
        received_at TEXT,
        completed_at TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS receiver_settings (
        room_id INT PRIMARY KEY,
        actions TEXT NOT NULL,
        sound_url TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS agenda (
        id INT PRIMARY KEY AUTO_INCREMENT,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        task TEXT NOT NULL,
        is_done TINYINT DEFAULT 0,
        is_cancelled TINYINT DEFAULT 0,
        order_index INT DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS important_files (
        id INT PRIMARY KEY AUTO_INCREMENT,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'عام',
        file_path TEXT NOT NULL,
        uploaded_at TEXT NOT NULL
      )
    `);

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
        console.log(`✅ تم إنشاء المستخدم: ${u.username}`);
      } else if (!rows[0].role || rows[0].role === '' || rows[0].role !== u.role) {
        await pool.query('UPDATE users SET role = ?, room_id = ? WHERE username = ?', [u.role, u.room_id, u.username]);
        console.log(`✅ تم تحديث بيانات المستخدم: ${u.username}`);
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
    console.log('✅ تم فحص وإدراج الأقسام الافتراضية');

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
    console.log('✅ تم فحص وإدراج إعدادات الأزرار الافتراضية');

    console.log("\n✅ تم تهيئة قاعدة البيانات MySQL بنجاح.");
    process.exit(0);
  } catch (error) {
    console.error("❌ خطأ في تهيئة قاعدة البيانات:", error);
    process.exit(1);
  }
}

init();