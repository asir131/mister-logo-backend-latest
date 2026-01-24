# Mister Logo Backend

Express.js backend with email OTP verification, JWT access tokens, and refresh tokens.

## Setup

Create a `.env` file with:

```
PORT=5000
JWT_SECRET=safsdfgasefasfasfsaf
JWT_EXPIRES_IN=1h
MONGODB_URI=mongodb+srv://afaysal220:Faysal20122@blinkit.typzf.mongodb.net/mister
CORS_ORIGINS=http://localhost:3000,http://localhost:5173

EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=afaysal220@gmail.com
EMAIL_PASS=npzp eabo veuk tnlr
EMAIL_FROM=afaysal220@gmail.com

CLOUDINARY_CLOUD_NAME=ddty8zoxr
CLOUDINARY_API_KEY=148938264955972
CLOUDINARY_API_SECRET=cmMy7WcbWPsDjw9ms1UPAaPMK9Y

FACEBOOK_APP_ID=your_facebook_app_id
FACEBOOK_APP_SECRET=your_facebook_app_secret
FACEBOOK_CALLBACK_URL=http://localhost:5000/api/auth/facebook/callback

ADMIN_API_KEY=your_admin_key_here
ADMIN_EMAIL=admin@admin.com
ADMIN_PASSWORD=1234
ADMIN_JWT_EXPIRES_IN=12h
UBLAST_SHARE_WINDOW_HOURS=48
UBLAST_BLOCK_DAYS=90
```

Install and run:

```
npm install
npm run dev   # dev with nodemon
# or
npm start     # production
```

## Routes

- `POST /api/auth/register` — body: `{ name, email, phoneNumber, password, confirmPassword }`. Sends a 5-digit OTP to the email.
- `POST /api/auth/verify-otp` — body: `{ email, otp }`. Completes registration, returns access token, refresh token, and user (no password hash).
- `POST /api/auth/login` — body: `{ email?, phoneNumber?, password }`. Email or phone is required. Returns access token, refresh token, and user.
- `POST /api/auth/refresh` — body: `{ refreshToken }`. Rotates refresh token and returns new access+refresh tokens and user.
- `POST /api/auth/forgot-password` — body: `{ email }`. Sends a 5-digit OTP to email if the account exists.
- `POST /api/auth/verify-reset-otp` — body: `{ email, otp }`. Verifies reset OTP and returns a short-lived reset token.
- `POST /api/auth/reset-password` — headers: `x-reset-token`, body: `{ newPassword, confirmPassword }`. Verifies reset token and updates password, returning new access+refresh tokens and user.
- `GET /api/auth/facebook` redirect to Facebook login.
- `GET /api/auth/facebook/callback` Facebook OAuth callback. Returns access token, refresh token, and user.

## Profile Routes (Bearer auth required)

- `GET /api/profile/me` returns the current user's profile if it exists (including counts and media lists):
  ```
  {
    "profile": {
      "_id": "...",
      "userId": "...",
      "username": "...",
      "displayName": "...",
      "role": "...",
      "bio": "...",
      "profileImageUrl": "...",
      "instagramUrl": "...",
      "tiktokUrl": "...",
      "youtubeUrl": "...",
      "facebookUrl": "...",
      "spotifyArtistUrl": "...",
      "postsCount": 0,
      "followersCount": 0,
      "followingCount": 0,
      "imageCount": 0,
      "videoCount": 0,
      "audioCount": 0,
      "followers": [{ "userId": "...", "followedAt": "..." }],
      "following": [{ "userId": "...", "followedAt": "..." }],
      "imagePosts": [{ "postId": "...", "mediaUrl": "...", "description": "...", "createdAt": "..." }],
      "videoPosts": [{ "postId": "...", "mediaUrl": "...", "description": "...", "createdAt": "..." }],
      "audioPosts": [{ "postId": "...", "mediaUrl": "...", "description": "...", "createdAt": "..." }]
    }
  }
  ```
- `POST /api/profile/complete` multipart/form-data: `profileImage` (file), fields `{ username, role, bio?, displayName?, instagramUrl?, tiktokUrl?, youtubeUrl?, facebookUrl?, spotifyArtistUrl? }`. Creates the user's profile.
- `PATCH /api/profile/me` multipart/form-data: optional `profileImage` and any fields above to update profile.

## Post Routes (Bearer auth required)

- `POST /api/posts` multipart/form-data: `media` (file), fields `{ description?, shareToFacebook?, shareToInstagram? }`.
  - Accepts image/video/audio uploads.
  - Shares are queued asynchronously (placeholder worker logs for now).
- `POST /api/posts` optional field `scheduledFor` (ISO8601) to schedule a post for future publishing.
- `GET /api/posts/scheduled` list the current user's scheduled posts (includes status/publishedAt).
- `PATCH /api/posts/:postId/scheduled` update a scheduled post (fields: `description?`, `scheduledFor`, `shareToFacebook?`, `shareToInstagram?`, optional `media`).
- `POST /api/posts/:postId/cancel` cancel a scheduled post.
- `POST /api/posts/:postId/share` creates a new feed post by re-sharing an existing post.
- `DELETE /api/posts/:postId` delete a post owned by the current user.

## Feed Routes (Bearer auth required)

- `GET /api/feed` query params: `page?`, `limit?` (default newest first). Returns posts with author, profile, like/comment counts, and viewer follow/like flags.

## Saved Post Routes (Bearer auth required)

- `POST /api/saved-posts` body: `{ postId }` save a post.
- `DELETE /api/saved-posts/:postId` remove a saved post.
- `GET /api/saved-posts` query params: `page?`, `limit?` (default newest saved first). Returns posts with author, profile, like/comment counts, and viewer follow/like/saved flags.

## Follow Routes (Bearer auth required)

- `POST /api/follows` body: `{ userId }` follow a user.
- `DELETE /api/follows/:userId` unfollow a user.

## Like Routes (Bearer auth required)

- `POST /api/likes` body: `{ postId }` like a post.
- `DELETE /api/likes/:postId` unlike a post.

## Comment Routes (Bearer auth required)

- `POST /api/comments` body: `{ postId, text }` add a comment.
- `GET /api/comments` query params: `postId`, `page?`, `limit?` paginate comments (newest first).
- `DELETE /api/comments/:commentId` delete a comment owned by the current user.

## Chat Routes (Bearer auth required, mutual follows only)

- `GET /api/chats` returns chat list for mutual follows with last message + unread count.
- `GET /api/chats/:userId/messages` query params: `page?`, `limit?` returns conversation messages (newest last).
- `POST /api/chats/:userId/messages` multipart/form-data: optional `text`, optional `file` (image/video/audio/other). Creates conversation if missing.
- `POST /api/chats/:userId/read` marks messages from the user as read.

## User Profile Routes (Bearer auth required)

- `GET /api/users/:userId/overview` returns user + profile + counts (posts, followers, following) + media counts + viewer follow state.
- `GET /api/users/:userId/posts` query params: `mediaType` (`image|video|audio`), `page?`, `limit?` returns posts for that user and media type.

## Trending & UBlast Routes (Bearer auth required)

- `GET /api/trending` returns top/manual/organic sections (pagination: `topPage`, `manualPage`, `organicPage`, `topLimit`, `manualLimit`, `organicLimit`).
- `GET /api/ublasts/eligibility` returns eligibility + blockedUntil.
- `GET /api/ublasts/active` returns active UBlasts with share status info (pagination: `page`, `limit`).
- `POST /api/ublasts/:ublastId/share` body: `{ shareType: "feed" | "story" }` creates a share post.
- `POST /api/ublasts/:ublastId/submissions` multipart/form-data: `media` (file), optional `title`, optional `content`, optional `proposedDate`.
- `POST /api/ublasts/submissions` multipart/form-data: `media` (file), optional `title`, optional `content`, optional `proposedDate`.
- `GET /api/ublasts/submissions` list the current user's UBlast submissions (pagination: `page`, `limit`).
- `PATCH /api/ublasts/submissions/:submissionId` multipart/form-data: optional `title`, optional `content`, optional `proposedDate`, optional `media` (file). Only pending submissions can be edited.

## Admin Routes (Admin API key required)

Admin auth:

- `POST /api/admin/auth/login` body: `{ email, password }` returns admin JWT token.

All admin routes accept either `Authorization: Bearer <token>` or `x-admin-key: ADMIN_API_KEY`.

- `GET /api/admin/ublasts` list UBlasts (optional `status` query).
- `POST /api/admin/ublasts` multipart/form-data: `title`, optional `content`, optional `scheduledFor`, optional `media`.
- `POST /api/admin/ublasts/:ublastId/release` releases a UBlast immediately (24h top trending window) and auto-assigns to eligible users.
- `GET /api/admin/ublasts/submissions` list submissions (optional `status`, `ublastId`).
- `PATCH /api/admin/ublasts/submissions/:submissionId` body: `{ status: "approved" | "rejected", reviewNotes? }`.
- `GET /api/admin/trending/overview` returns top/manual/organic sections for admin dashboard.
- `GET /api/admin/trending/manual` list manual placements.
- `POST /api/admin/trending/manual` body: `{ postId, position?, startAt?, endAt? }`.
- `PATCH /api/admin/trending/manual/:placementId` body: `{ position }` update manual pin position (swaps if occupied).
- `DELETE /api/admin/trending/manual/:placementId` remove manual placement.

## Notes

- OTPs expire after 10 minutes and are stored in MongoDB with a TTL index.
- Users persist in MongoDB (`MONGODB_URI`).
- Refresh tokens are opaque, stored hashed in MongoDB, and rotated on each refresh.
- Facebook/Instagram sharing requires Meta Graph API credentials and permissions.
- Socket.IO uses JWT auth via `handshake.auth.token`, and emits `message:new` to both participants.
- Sharing a UBlast creates a feed post from the UBlast media/content.
- Users with active, unshared UBlast assignments are blocked from creating normal posts until they share.
- Users must share active UBlasts before creating normal posts.
