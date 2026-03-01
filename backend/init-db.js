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
        role ENUM('manager', 'secretary', 'kitchen', 'office-manager') NOT NULL,
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
    ];

    for (const u of defaultUsers) {
      const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', [u.username]);
      if (rows.length === 0) {
        const hashed = bcrypt.hashSync(u.password, 10);
        await pool.query('INSERT INTO users (username, password, role, room_id) VALUES (?, ?, ?, ?)', [u.username, hashed, u.role, u.room_id]);
        console.log(`✅ تم إنشاء المستخدم: ${u.username}`);
      }
    }

    // إدراج الأقسام الافتراضية
    const defaultSections = [
      { id: 2, title: 'قسم السكرتارية', iconName: 'User', color: '#3b82f6', actions: JSON.stringify(['استدعاء فوري', 'طلب اجتماع', 'تجهيز أوليات']) },
      { id: 4, title: 'إدارة المكتب', iconName: 'Briefcase', color: '#a855f7', actions: JSON.stringify(['مراجعة البريد', 'جدول المواعيد', 'استقبال ضيوف']) },
      { id: 3, title: 'خدمات المطبخ', iconName: 'Coffee', color: '#f97316', actions: JSON.stringify(['شاي', 'قهوة سادة', 'ماء']) },
    ];

    const [secRows] = await pool.query('SELECT COUNT(*) as cnt FROM sections');
    if (secRows[0].cnt === 0) {
      for (const s of defaultSections) {
        await pool.query('INSERT INTO sections (id, title, iconName, color, actions) VALUES (?, ?, ?, ?, ?)', [s.id, s.title, s.iconName, s.color, s.actions]);
      }
      console.log('✅ تم إدراج الأقسام الافتراضية');
    }

    // إدراج إعدادات الأزرار الافتراضية
    const [settRows] = await pool.query('SELECT COUNT(*) as cnt FROM receiver_settings');
    if (settRows[0].cnt === 0) {
      const defaultReceiverSettings = [
        { room_id: 2, actions: JSON.stringify(['استئذان دخول', 'قدوم ضيف', 'مذكرة جاهزة للتوقيع', 'امر طارئ']) },
        { room_id: 4, actions: JSON.stringify(['استئذان دخول', 'ضيف بالانتظار', 'البريد جاهزة للتوقيع', 'امر طارئ']) },
        { room_id: 3, actions: JSON.stringify(['استئذان دخول', 'الطلب جاهز', 'الفطور جاهز', 'الغداء جاهز']) },
      ];
      for (const s of defaultReceiverSettings) {
        await pool.query('INSERT INTO receiver_settings (room_id, actions) VALUES (?, ?)', [s.room_id, s.actions]);
      }
      console.log('✅ تم إدراج إعدادات الأزرار الافتراضية');
    }

    console.log("\n✅ تم تهيئة قاعدة البيانات MySQL بنجاح.");
    process.exit(0);
  } catch (error) {
    console.error("❌ خطأ في تهيئة قاعدة البيانات:", error);
    process.exit(1);
  }
}

init();