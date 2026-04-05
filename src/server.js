const express = require("express");
const http = require("http");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const passport = require("passport");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { registerChatSocket } = require("./sockets/chatSocket");
const {
  addOnlineUser,
  removeOnlineUser,
  getOnlineUserIds,
} = require("./store/onlineUsers");

dotenv.config();
require("./config/passport");

const authRoutes = require("./routes/authRoutes");
const profileRoutes = require("./routes/profileRoutes");
const postRoutes = require("./routes/postRoutes");
const followRoutes = require("./routes/followRoutes");
const likeRoutes = require("./routes/likeRoutes");
const commentRoutes = require("./routes/commentRoutes");
const feedRoutes = require("./routes/feedRoutes");
const userRoutes = require("./routes/userRoutes");
const savedPostRoutes = require("./routes/savedPostRoutes");
const chatRoutes = require("./routes/chatRoutes");
const trendingRoutes = require("./routes/trendingRoutes");
const ublastRoutes = require("./routes/ublastRoutes");
const adminUblastRoutes = require("./routes/adminUblastRoutes");
const adminAuthRoutes = require("./routes/adminAuthRoutes");
const shareRoutes = require("./routes/shareRoutes");
const mediaProxyRoutes = require("./routes/mediaProxyRoutes");
const accountsRoutes = require("./routes/accountsRoutes");
const webhooksRoutes = require("./routes/webhooksRoutes");
const ucutRoutes = require("./routes/ucutRoutes");
const viewRoutes = require("./routes/viewRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const translateRoutes = require("./routes/translateRoutes");
const ublastOfferRoutes = require("./routes/ublastOfferRoutes");
const supportRoutes = require("./routes/supportRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const youtubeRoutes = require("./routes/youtubeRoutes");
const { startUblastJobs } = require("./jobs/ublastScheduler");
const { startPostScheduler } = require("./jobs/postScheduler");
const { sharePage, shareXLink } = require("./controllers/sharePageController");

const app = express();
const server = http.createServer(app);
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((value) => value.trim())
  : [
      "http://localhost:3000",
      "http://localhost:5173",
      "https://ungustatory-erringly-ralph.ngrok-free.dev",
      "https://mister-logo-dashboard-vuek.vercel.app",
      "https://unap-dashboard-833630612791.us-central1.run.app",
    ];
const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "ngrok-skip-browser-warning",
    "x-admin-key",
    "Cache-Control",
    "Pragma",
  ],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(passport.initialize());

app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/follows", followRoutes);
app.use("/api/likes", likeRoutes);
app.use("/api/comments", commentRoutes);
app.use("/api/feed", feedRoutes);
app.use("/api/users", userRoutes);
app.use("/api/saved-posts", savedPostRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/trending", trendingRoutes);
app.use("/api/ublasts", ublastRoutes);
app.use("/api/share", shareRoutes);
app.use("/", mediaProxyRoutes);
app.use("/api/accounts", accountsRoutes);
app.use("/api/ucuts", ucutRoutes);
app.use("/api/views", viewRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/translate", translateRoutes);
app.use("/api/ublast-offers", ublastOfferRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/youtube", youtubeRoutes);
app.use("/api/admin/auth", adminAuthRoutes);
app.use("/api/admin", adminUblastRoutes);
app.use("/webhooks", webhooksRoutes);

// Basic health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Public share page (Open Graph preview)
app.get("/share/:postId", sharePage);
app.get("/share/x/:postId", shareXLink);

// Public account deletion information page (required by Google Play policy)
app.get("/unap-account-deletion", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>UNAP Account Deletion</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 24px; line-height: 1.6; color: #111; background: #f7f7f8; }
      .card { max-width: 780px; margin: 0 auto; background: #fff; border: 1px solid #e6e6e9; border-radius: 12px; padding: 24px; }
      h1, h2 { margin-top: 0; }
      code { background: #f1f1f4; padding: 2px 6px; border-radius: 4px; }
      ul { padding-left: 20px; }
      .muted { color: #555; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>UNAP Account and Data Deletion</h1>
      <p>
        If you want to delete your UNAP account and associated data, you can do it directly from the app or by contacting support.
      </p>

      <h2>How to delete your account in the app</h2>
      <ol>
        <li>Log in to your UNAP account.</li>
        <li>Go to <strong>Profile</strong> &gt; <strong>Settings</strong>.</li>
        <li>Tap <strong>Delete Account</strong> and confirm.</li>
      </ol>

      <h2>Data deleted after account deletion</h2>
      <ul>
        <li>Profile information</li>
        <li>User-generated posts, including photos/videos and captions</li>
        <li>Linked social account records associated with your UNAP account</li>
      </ul>

      <h2>Data retention</h2>
      <p class="muted">
        Some operational logs and legally required records may be retained for up to 90 days for security, fraud prevention, and compliance purposes.
      </p>

      <h2>Alternative deletion request</h2>
      <p>
        If you cannot access the app, contact support and request account deletion:
        <br />
        <code>support@unitedartistsofpower.com</code>
      </p>
    </div>
  </body>
</html>`);
});

// Global error handler fallback
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      error:
        "File too large. Max upload size: posts/ublasts 300MB, ucuts 100MB.",
    });
  }
  const status = err.status || 500;
  const message = err.message || "Internal server error";
  res.status(status).json({ error: message });
});

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

io.use((socket, next) => {
  const authToken = socket.handshake.auth?.token;
  const queryToken = socket.handshake.query?.token;
  const header = socket.handshake.headers?.authorization || "";
  const headerToken = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : "";
  const token =
    authToken ||
    (Array.isArray(queryToken) ? queryToken[0] : queryToken) ||
    headerToken;
  if (!token) return next(new Error("Authorization token required."));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded?.sub) return next(new Error("Invalid token."));
    socket.userId = decoded.sub;
    return next();
  } catch (err) {
    return next(new Error("Invalid or expired token."));
  }
});

io.on("connection", (socket) => {
  if (socket.userId) {
    socket.join(`user:${socket.userId}`);
    const becameOnline = addOnlineUser(socket.userId, socket.id);
    socket.emit("presence:list", {
      onlineUserIds: Array.from(getOnlineUserIds()),
    });
    if (becameOnline) {
      io.emit("presence:update", { userId: socket.userId, online: true });
    }
  }

  socket.on("presence:join", () => {
    socket.emit("presence:list", {
      onlineUserIds: Array.from(getOnlineUserIds()),
    });
  });

  socket.on("presence:list", () => {
    socket.emit("presence:list", {
      onlineUserIds: Array.from(getOnlineUserIds()),
    });
  });

  registerChatSocket(io, socket);

  socket.on("disconnect", () => {
    if (socket.userId) {
      const becameOffline = removeOnlineUser(socket.userId, socket.id);
      if (becameOffline) {
        io.emit("presence:update", { userId: socket.userId, online: false });
      }
    }
  });
});

app.set("io", io);
server.on("error", (err) => {
  if (err?.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Stop the existing process or use another PORT.`,
    );
    process.exit(1);
  }
  console.error("Server startup error:", err);
  process.exit(1);
});

connectDB()
  .then(() => {
    startUblastJobs(io);
    startPostScheduler();
    server.listen(PORT, () => {
      // Simple startup log for visibility
      console.log(`Server running on port ${PORT}`);
      console.log(
        `GOOGLE_CALLBACK_URL: ${process.env.GOOGLE_CALLBACK_URL || ""}`,
      );
    });
  })
  .catch((err) => {
    console.error("Failed to connect to database:", err);
    process.exit(1);
  });
