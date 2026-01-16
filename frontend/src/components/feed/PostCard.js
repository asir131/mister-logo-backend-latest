import Link from "next/link";
import { useMemo, useState } from "react";

function initials(name) {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return date.toLocaleString();
}

export default function PostCard({
  post,
  currentUserId,
  onToggleFollow,
  onToggleLike,
  onToggleSave,
  commentsState,
  onLoadComments,
  onAddComment,
}) {
  const [commentText, setCommentText] = useState("");
  const media = useMemo(() => {
    if (post.mediaType === "image") {
      return <img src={post.mediaUrl} alt="post media" className="post-media" />;
    }
    if (post.mediaType === "video") {
      return (
        <video className="post-media" controls>
          <source src={post.mediaUrl} />
        </video>
      );
    }
    if (post.mediaType === "audio") {
      return (
        <audio className="post-media" controls>
          <source src={post.mediaUrl} />
        </audio>
      );
    }
    return null;
  }, [post.mediaType, post.mediaUrl]);

  const authorName = post.profile?.displayName || post.author?.name || "User";
  const authorRole = post.profile?.role || post.profile?.username || "";
  const avatarUrl = post.profile?.profileImageUrl;
  const canFollow = post.author?.id && post.author.id !== currentUserId;

  const profileLink = post.author?.id ? `/users/${post.author.id}` : "#";

  return (
    <section className="card post-card">
      <div className="post-header">
        <Link className="avatar" href={profileLink}>
          {avatarUrl ? (
            <img src={avatarUrl} alt={authorName} />
          ) : (
            <span>{initials(authorName)}</span>
          )}
        </Link>
        <div className="post-meta">
          <Link className="post-author" href={profileLink}>
            {authorName}
          </Link>
          <div className="post-sub">{authorRole}</div>
          {post.ublastId && <span className="badge">Shared from UBlast</span>}
        </div>
        {canFollow && (
          <button
            className="btn ghost"
            type="button"
            onClick={() => onToggleFollow(post)}
          >
            {post.viewerIsFollowing ? "Unfollow" : "Follow"}
          </button>
        )}
      </div>

      <div className="post-body">
        {media}
        {post.description && <p className="post-text">{post.description}</p>}
      </div>

      <div className="post-actions">
        <button className="btn ghost" type="button" onClick={() => onToggleLike(post)}>
          {post.viewerHasLiked ? "Unlike" : "Like"} Aú {post.likeCount}
        </button>
        {onToggleSave && (
          <button
            className="btn ghost"
            type="button"
            onClick={() => onToggleSave(post)}
          >
            {post.viewerHasSaved ? "Unsave" : "Save"}
          </button>
        )}
        <button className="btn ghost" type="button" onClick={() => onLoadComments(post)}>
          Comments Aú {post.commentCount}
        </button>
        <span className="post-time">{formatTime(post.createdAt)}</span>
      </div>

      <div className="comment-box">
        <input
          name="comment"
          value={commentText}
          onChange={(event) => setCommentText(event.target.value)}
          placeholder="Write a comment..."
        />
        <button
          className="btn"
          type="button"
          onClick={() => {
            const trimmed = commentText.trim();
            if (!trimmed) return;
            onAddComment(post, trimmed);
            setCommentText("");
          }}
        >
          Send
        </button>
      </div>

      {commentsState && (
        <div className="comments">
          {commentsState.items?.map((comment) => (
            <div className="comment" key={comment._id || comment.id}>
              <div className="comment-avatar">
                {comment.profile?.profileImageUrl ? (
                  <img
                    src={comment.profile.profileImageUrl}
                    alt={comment.user?.name || "User"}
                  />
                ) : (
                  <span>{initials(comment.user?.name)}</span>
                )}
              </div>
              <div className="comment-body">
                <div className="comment-author">
                  {comment.profile?.displayName || comment.user?.name || "User"}
                </div>
                <div className="comment-text">{comment.text}</div>
              </div>
            </div>
          ))}
          {commentsState.loading && <div className="muted">Loading comments...</div>}
          {commentsState.page < commentsState.totalPages && !commentsState.loading && (
            <button
              className="btn ghost"
              type="button"
              onClick={() => onLoadComments(post, commentsState.page + 1)}
            >
              Load more comments
            </button>
          )}
        </div>
      )}
    </section>
  );
}
