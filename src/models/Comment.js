const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
    parentCommentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null, index: true },
    text: { type: String, required: true },
    replyCount: { type: Number, default: 0 },
    likedBy: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
    mentions: {
      type: [
        {
          userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
          username: { type: String, default: '' },
          name: { type: String, default: '' },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

commentSchema.index({ postId: 1, parentCommentId: 1, createdAt: -1 });
commentSchema.index({ likedBy: 1 });

module.exports = mongoose.model('Comment', commentSchema);
