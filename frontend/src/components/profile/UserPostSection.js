import { useTranslations } from "../../lib/useTranslations";

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function MediaPreview({ post }) {
  if (post.mediaType === "image") {
    return <img src={post.mediaUrl} alt={post.description || "post"} />;
  }
  if (post.mediaType === "video") {
    return (
      <video controls>
        <source src={post.mediaUrl} />
      </video>
    );
  }
  return (
    <audio controls>
      <source src={post.mediaUrl} />
    </audio>
  );
}

export default function UserPostSection({
  title,
  posts,
  loading,
  canLoadMore,
  onLoadMore,
}) {
  const labels = ["No posts yet.", "likes", "comments", "Loading...", "Load more"];
  const contentTexts = posts.map((post) => post.description).filter(Boolean);
  const { t } = useTranslations([title, ...labels, ...contentTexts]);

  return (
    <section className="card">
      <h2>{t(title)}</h2>
      {posts.length === 0 && !loading && <p className="muted">{t("No posts yet.")}</p>}
      <div className="media-grid">
        {posts.map((post) => (
          <div className="media-card" key={post._id}>
            <MediaPreview post={post} />
            {post.description && <div>{t(post.description)}</div>}
            <div className="media-meta">
              {post.likeCount} {t("likes")} · {post.commentCount} {t("comments")}
            </div>
            <div className="media-meta">{formatTime(post.createdAt)}</div>
          </div>
        ))}
      </div>
      {loading && <p className="muted">{t("Loading...")}</p>}
      {canLoadMore && !loading && (
        <button className="btn ghost" type="button" onClick={onLoadMore}>
          {t("Load more")}
        </button>
      )}
    </section>
  );
}
