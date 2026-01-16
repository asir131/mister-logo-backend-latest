const express = require('express');
const http = require('http');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const passport = require('passport');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { registerChatSocket } = require('./sockets/chatSocket');

dotenv.config();
require('./config/passport');

const authRoutes = require('./routes/authRoutes');
const profileRoutes = require('./routes/profileRoutes');
const postRoutes = require('./routes/postRoutes');
const followRoutes = require('./routes/followRoutes');
const likeRoutes = require('./routes/likeRoutes');
const commentRoutes = require('./routes/commentRoutes');
const feedRoutes = require('./routes/feedRoutes');
const userRoutes = require('./routes/userRoutes');
const savedPostRoutes = require('./routes/savedPostRoutes');
const chatRoutes = require('./routes/chatRoutes');
const trendingRoutes = require('./routes/trendingRoutes');
const ublastRoutes = require('./routes/ublastRoutes');
const adminUblastRoutes = require('./routes/adminUblastRoutes');
const adminAuthRoutes = require('./routes/adminAuthRoutes');
const { startUblastJobs } = require('./jobs/ublastScheduler');

const app = express();
const server = http.createServer(app);
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((value) => value.trim())
  : ['http://localhost:3000', 'http://localhost:5173'];
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);
app.use(express.json());
app.use(passport.initialize());

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/follows', followRoutes);
app.use('/api/likes', likeRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/users', userRoutes);
app.use('/api/saved-posts', savedPostRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/trending', trendingRoutes);
app.use('/api/ublasts', ublastRoutes);
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin', adminUblastRoutes);

// Basic health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Global error handler fallback
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || 'Internal server error';
  res.status(status).json({ error: message });
});

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

io.use((socket, next) => {
  const authToken = socket.handshake.auth?.token;
  const queryToken = socket.handshake.query?.token;
  const header = socket.handshake.headers?.authorization || '';
  const headerToken = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : '';
  const token =
    authToken ||
    (Array.isArray(queryToken) ? queryToken[0] : queryToken) ||
    headerToken;
  if (!token) return next(new Error('Authorization token required.'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded?.sub) return next(new Error('Invalid token.'));
    socket.userId = decoded.sub;
    return next();
  } catch (err) {
    return next(new Error('Invalid or expired token.'));
  }
});

io.on('connection', (socket) => {
  if (socket.userId) {
    socket.join(`user:${socket.userId}`);
  }
  registerChatSocket(io, socket);
});

app.set('io', io);
connectDB()
  .then(() => {
    startUblastJobs();
    server.listen(PORT, () => {
      // Simple startup log for visibility
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to database:', err);
    process.exit(1);
  });
