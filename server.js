// ============================================================
// server.js — Zərif Yardım Birliyi Backend
// Node.js + Express + MongoDB (Mongoose) + Cloudinary + JWT
// ============================================================

import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cors from "cors";
import dotenv from "dotenv";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import multer from "multer";

dotenv.config();

const app = express();

// ============================================================
// ✅ CORS - TAM GENİŞ KONFİQURASİYA (FIX)
// ============================================================
app.use(cors({
  origin: '*', // Bütün origin-lərə icazə ver (test üçün)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

// OPTIONS sorğularını idarə et
app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// CLOUDINARY KONFİQURASİYASI
// ============================================================

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const isVideo = file.mimetype.startsWith("video/");
    return {
      folder:        "zerif-yardim",
      resource_type: isVideo ? "video" : "image",
      allowed_formats: ["jpg", "jpeg", "png", "webp", "gif", "mp4", "mov", "avi"],
    };
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB (azaldıldı)
});

// ============================================================
// MONGOOSE MODELLƏRİ
// ============================================================

// Admin modeli
const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
}, { timestamps: true });

const Admin = mongoose.model("Admin", adminSchema);

// Media modeli (şəkil / video)
const mediaSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  description: { type: String, default: "" },
  url:         { type: String, required: true },
  publicId:    { type: String, required: true },
  mediaType:   { type: String, enum: ["image", "video"], default: "image" },
}, { timestamps: true });

const Media = mongoose.model("Media", mediaSchema);

// Əlaqə (Contact) modeli
const contactSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName:  { type: String, required: true },
  phone:     { type: String, required: true },
  message:   { type: String, required: true },
}, { timestamps: true });

const Contact = mongoose.model("Contact", contactSchema);

// ============================================================
// SEED — Default Admin (əgər yoxdursa yarat)
// ============================================================

async function seedAdmin() {
  try {
    const existing = await Admin.findOne({ username: process.env.ADMIN_USERNAME || "admin" });
    if (!existing) {
      const hashed = await bcrypt.hash(process.env.ADMIN_PASSWORD || "admin123", 12);
      await Admin.create({
        username: process.env.ADMIN_USERNAME || "admin",
        password: hashed,
      });
      console.log("✅ Default admin yaradıldı.");
    } else {
      console.log("✅ Admin artıq mövcuddur.");
    }
  } catch (err) {
    console.error("❌ Admin seed xətası:", err.message);
  }
}

// ============================================================
// JWT MİDDLEWARE
// ============================================================

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Token yoxdur." });
  }

  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ message: "Token etibarsızdır." });
  }
}

// ============================================================
// ✅ TEST ROUTE (FIX - Backend-in işlədiyini yoxlamaq üçün)
// ============================================================

app.get("/api/test", (req, res) => {
  res.json({ 
    message: "✅ Backend işləyir!",
    timestamp: new Date().toISOString(),
    status: "online",
    endpoints: {
      auth: "/api/auth/login",
      media: "/api/media",
      contact: "/api/contact"
    }
  });
});

// ============================================================
// ROUTES — AUTH
// ============================================================

// POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: "İstifadəçi adı və şifrə tələb olunur." });
    }

    const admin = await Admin.findOne({ username });
    if (!admin) {
      return res.status(401).json({ message: "Yanlış istifadəçi adı və ya şifrə." });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Yanlış istifadəçi adı və ya şifrə." });
    }

    const token = jwt.sign(
      { id: admin._id, username: admin.username },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ 
      token, 
      username: admin.username,
      message: "Giriş uğurlu!"
    });
  } catch (err) {
    console.error("Login xətası:", err);
    res.status(500).json({ message: "Server xətası.", error: err.message });
  }
});

// GET /api/auth/verify — Token yoxlanması
app.get("/api/auth/verify", authMiddleware, (req, res) => {
  res.json({ valid: true, admin: req.admin });
});

// ============================================================
// ROUTES — MEDIA (Qaleriya)
// ============================================================

// GET /api/media — Bütün media siyahısı (public)
app.get("/api/media", async (req, res) => {
  try {
    const items = await Media.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    console.error("Media get xətası:", err);
    res.status(500).json({ message: "Server xətası.", error: err.message });
  }
});

// POST /api/media — Yeni media yüklə (admin only)
app.post(
  "/api/media",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "Fayl seçilməyib." });
      }

      const { title, description } = req.body;
      if (!title) {
        return res.status(400).json({ message: "Başlıq tələb olunur." });
      }

      const isVideo = req.file.mimetype.startsWith("video/");

      const media = await Media.create({
        title,
        description: description || "",
        url:        req.file.path,
        publicId:   req.file.filename,
        mediaType:  isVideo ? "video" : "image",
      });

      res.status(201).json({
        message: "Media uğurla yükləndi!",
        media
      });
    } catch (err) {
      console.error("Media upload xətası:", err);
      res.status(500).json({ message: "Yükləmə xətası.", error: err.message });
    }
  }
);

// DELETE /api/media/:id — Media sil (admin only)
app.delete("/api/media/:id", authMiddleware, async (req, res) => {
  try {
    const media = await Media.findById(req.params.id);
    if (!media) {
      return res.status(404).json({ message: "Media tapılmadı." });
    }

    // Cloudinary-dən də sil
    const resourceType = media.mediaType === "video" ? "video" : "image";
    await cloudinary.uploader.destroy(media.publicId, { resource_type: resourceType });

    await media.deleteOne();
    res.json({ message: "Media uğurla silindi." });
  } catch (err) {
    console.error("Media delete xətası:", err);
    res.status(500).json({ message: "Silmə xətası.", error: err.message });
  }
});

// ============================================================
// ROUTES — CONTACT (Əlaqə Forması)
// ============================================================

// POST /api/contact
app.post("/api/contact", async (req, res) => {
  try {
    const { firstName, lastName, phone, message } = req.body;
    
    if (!firstName || !lastName || !phone || !message) {
      return res.status(400).json({ message: "Bütün sahələr tələb olunur." });
    }

    const contact = await Contact.create({ 
      firstName, 
      lastName, 
      phone, 
      message 
    });
    
    res.status(201).json({ 
      message: "Müraciətiniz qəbul edildi.", 
      id: contact._id 
    });
  } catch (err) {
    console.error("Contact xətası:", err);
    res.status(500).json({ message: "Server xətası.", error: err.message });
  }
});

// GET /api/contact — Müraciətlər siyahısı (admin only)
app.get("/api/contact", authMiddleware, async (req, res) => {
  try {
    const contacts = await Contact.find().sort({ createdAt: -1 });
    res.json(contacts);
  } catch (err) {
    console.error("Contact get xətası:", err);
    res.status(500).json({ message: "Server xətası.", error: err.message });
  }
});

// ============================================================
// 404 - Tapılmadı
// ============================================================

app.use((req, res) => {
  res.status(404).json({ 
    message: "API endpoint tapılmadı.",
    path: req.originalUrl
  });
});

// ============================================================
// ERROR HANDLING MIDDLEWARE
// ============================================================

app.use((err, req, res, next) => {
  console.error("Global xəta:", err);
  res.status(500).json({ 
    message: "Daxili server xətası.",
    error: process.env.NODE_ENV === "development" ? err.message : undefined
  });
});

// ============================================================
// MONGODB BAĞLANTISI VƏ SERVER BAŞLATMA
// ============================================================

const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB bağlantısı uğurlu.");
    await seedAdmin();
    
    app.listen(PORT, () => {
      console.log(`🚀 Server http://localhost:${PORT} ünvanında işləyir.`);
      console.log(`📡 Test: http://localhost:${PORT}/api/test`);
      console.log(`🔐 Login: http://localhost:${PORT}/api/auth/login`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB bağlantı xətası:", err.message);
    process.exit(1);
  });