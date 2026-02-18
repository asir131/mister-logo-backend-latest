"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageShell from "../../components/PageShell";
import CreatePostForm from "../../components/forms/CreatePostForm";
import PostCard from "../../components/feed/PostCard";
import ShareModal from "../../components/share/ShareModal";
import { apiRequest } from "../../lib/apiClient";
import { clearAuth, getAuth, getProfile } from "../../lib/authStore";
import { useTranslations } from "../../lib/useTranslations";

const emptyPost = {
  description: "",
  shareTargets: [],
  scheduledFor: "",
};

const LARGE_UPLOAD_BYTES = 50 * 1024 * 1024;

function detectMediaType(file) {
  if (!file?.type) return null;
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

export default function FeedPage() {
  const router = useRouter();
  const [form, setForm] = useState(emptyPost);
  const [mediaFile, setMediaFile] = useState(null);
  const [status, setStatus] = useState(null);
  const [posts, setPosts] = useState([]);
  const [feedPage, setFeedPage] = useState(1);
  const [feedTotalPages, setFeedTotalPages] = useState(1);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState(null);
  const [commentsByPost, setCommentsByPost] = useState({});
  const [sharePost, setSharePost] = useState(null);
  const [ucuts, setUcuts] = useState([]);
  const [ucutLoading, setUcutLoading] = useState(false);
  const [ucutError, setUcutError] = useState(null);
  const [suggestedArtists, setSuggestedArtists] = useState([]);
  const [suggestedLoading, setSuggestedLoading] = useState(false);
  const [suggestedError, setSuggestedError] = useState(null);
  const [suggestedFollowing, setSuggestedFollowing] = useState([]);
  const [activeStoryOwner, setActiveStoryOwner] = useState(null);
  const [activeOwnerIndex, setActiveOwnerIndex] = useState(0);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0);
  const [ucutComments, setUcutComments] = useState({});
  const [commentText, setCommentText] = useState("");
  const [commentLoading, setCommentLoading] = useState(false);
  const viewedPostIdsRef = useRef(new Set());
  const auth = getAuth();
  const labels = [
    "Stories",
    "Loading stories...",
    "No stories yet.",
    "Close",
    "Prev",
    "Next",
    "Like",
    "Unlike",
    "Delete",
    "comments",
    "Write a comment...",
    "Send",
    "Comments are available only for mutual follows.",
    "Feed error",
    "Loading feed",
    "Fetching more posts...",
    "Load more posts",
    "Suggested artists",
    "Loading suggested artists...",
    "No suggested artists yet.",
    "Follow",
    "View",
    "Status",
  ];
  const { t } = useTranslations(labels);

  useEffect(() => {
    if (!auth.token) {
      router.push("/login");
      return;
    }
    const profileState = getProfile();
    if (!profileState.completed) {
      router.push("/complete-profile");
      return;
    }

    loadFeed(1, true);
    loadUcuts();
    loadSuggestedArtists();
  }, [router]);

  async function loadFeed(page, replace) {
    setFeedLoading(true);
    setFeedError(null);
    const result = await apiRequest({
      path: `/api/feed?page=${page}&limit=5`,
      method: "GET",
      token: auth.token,
    });
    if (!result.ok) {
      setFeedError(result.data?.error || "Failed to load feed.");
      setFeedLoading(false);
      return;
    }
    setFeedPage(result.data.page);
    setFeedTotalPages(result.data.totalPages);
    setPosts((prev) => (replace ? result.data.posts : [...prev, ...result.data.posts]));
    setFeedLoading(false);
  }

  async function recordView(postId) {
    if (!auth.token || !postId) return;
    await apiRequest({
      path: "/api/views/post",
      method: "POST",
      body: { postId },
      token: auth.token,
    });
  }

  async function loadUcuts() {
    setUcutLoading(true);
    setUcutError(null);
    const result = await apiRequest({
      path: "/api/ucuts/feed",
      method: "GET",
      token: auth.token,
    });
    if (!result.ok) {
      setUcutError(result.data?.error || "Failed to load UCuts.");
      setUcutLoading(false);
      return;
    }
    setUcuts(result.data.ucuts || []);
    setUcutLoading(false);
  }
  async function loadSuggestedArtists() {
    setSuggestedLoading(true);
    setSuggestedError(null);
    const result = await apiRequest({
      path: "/api/users/suggested-artists?limit=8",
      method: "GET",
      token: auth.token,
    });
    if (!result.ok) {
      setSuggestedError(result.data?.error || "Failed to load suggested artists.");
      setSuggestedLoading(false);
      return;
    }
    setSuggestedArtists(result.data.artists || []);
    setSuggestedLoading(false);
  }

  async function handleFollowSuggested(artistId) {
    if (!auth.token || !artistId) return;
    if (suggestedFollowing.includes(artistId)) return;
    setSuggestedFollowing((prev) => [...prev, artistId]);
    const result = await apiRequest({
      path: "/api/follows",
      method: "POST",
      body: { userId: artistId },
      token: auth.token,
    });
    setSuggestedFollowing((prev) => prev.filter((id) => id !== artistId));
    if (!result.ok) {
      setSuggestedError(result.data?.error || "Failed to follow artist.");
      return;
    }
    setSuggestedArtists((prev) => prev.filter((artist) => (artist.id || artist._id) !== artistId));
  }
  const stories = useMemo(() => {
    const byOwner = new Map();
    ucuts.forEach((ucut) => {
      const ownerId = ucut.owner?.id || ucut.userId;
      if (!byOwner.has(ownerId)) {
        byOwner.set(ownerId, []);
      }
      byOwner.get(ownerId).push(ucut);
    });
    return Array.from(byOwner.entries()).map(([ownerId, items]) => {
      const sorted = items.slice().sort((a, b) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      return { ownerId, items: sorted };
    });
  }, [ucuts]);

  function openStory(ownerId, startIndex = 0) {
    setActiveStoryOwner(ownerId);
    const ownerIndex = stories.findIndex((story) => story.ownerId === ownerId);
    setActiveOwnerIndex(Math.max(0, ownerIndex));
    setActiveStoryIndex(startIndex);
    setActiveSegmentIndex(0);
    setCommentText("");
  }

  function closeStory() {
    setActiveStoryOwner(null);
    setActiveOwnerIndex(0);
    setActiveStoryIndex(0);
    setActiveSegmentIndex(0);
    setCommentText("");
  }

  const activeStory = stories.find((story) => story.ownerId === activeStoryOwner);
  const activeUcut = activeStory?.items?.[activeStoryIndex] || null;
  const activeOwner = activeUcut?.owner || {};
  const canComment = Boolean(activeUcut?.canComment);

  const activeStorySegments = useMemo(() => {
    if (!activeStory) return [];
    const list = [];
    activeStory.items.forEach((ucut) => {
      if (ucut.type === "text") {
        list.push({
          kind: "text",
          text: ucut.text || "Text story",
          ucutId: ucut._id,
        });
        return;
      }
      const segments = Array.isArray(ucut.segments) ? ucut.segments : [];
      segments.forEach((segment) => {
        list.push({
          kind: ucut.type,
          url: segment.url,
          ucutId: ucut._id,
        });
      });
    });
    return list;
  }, [activeStory]);

  useEffect(() => {
    if (!activeStoryOwner || !activeStorySegments.length) return;
    const current = activeStorySegments[activeSegmentIndex];
    if (!current) return;
    const durationMs = current.kind === "video" || current.kind === "audio" ? 12000 : 5000;
    const timer = setTimeout(() => {
      goNextSegment();
    }, durationMs);
    return () => clearTimeout(timer);
  }, [activeStoryOwner, activeSegmentIndex, activeStorySegments.length]);

  async function loadUcutComments(ucutId) {
    if (!ucutId) return;
    const result = await apiRequest({
      path: `/api/ucuts/${ucutId}/comments`,
      method: "GET",
      token: auth.token,
    });
    if (!result.ok) return;
    setUcutComments((prev) => ({ ...prev, [ucutId]: result.data.comments || [] }));
  }

  async function handleAddUcutComment() {
    if (!activeUcut || !commentText.trim()) return;
    setCommentLoading(true);
    const result = await apiRequest({
      path: `/api/ucuts/${activeUcut._id}/comments`,
      body: { text: commentText.trim() },
      token: auth.token,
    });
    setCommentLoading(false);
    if (!result.ok) return;
    setCommentText("");
    loadUcutComments(activeUcut._id);
  }

  async function handleToggleUcutLike() {
    if (!activeUcut) return;
    const liked = activeUcut.viewerHasLiked;
    const result = await apiRequest({
      path: `/api/ucuts/${activeUcut._id}/like`,
      method: liked ? "DELETE" : "POST",
      token: auth.token,
    });
    if (!result.ok) return;
    setUcuts((prev) =>
      prev.map((item) => {
        if (item._id !== activeUcut._id) return item;
        return {
          ...item,
          viewerHasLiked: !liked,
          likeCount: item.likeCount + (!liked ? 1 : -1),
        };
      }),
    );
  }

  async function handleDeleteUcut() {
    if (!activeUcut) return;
    if (activeOwner?.id && auth.user?.id && activeOwner.id !== auth.user.id && activeOwner.id !== auth.user._id) {
      return;
    }
    const result = await apiRequest({
      path: `/api/ucuts/${activeUcut._id}`,
      method: "DELETE",
      token: auth.token,
    });
    if (!result.ok) return;
    setUcuts((prev) => prev.filter((item) => item._id !== activeUcut._id));
    closeStory();
  }

  useEffect(() => {
    if (activeUcut?._id && canComment && !ucutComments[activeUcut._id]) {
      loadUcutComments(activeUcut._id);
    }
  }, [activeUcut?._id, canComment]);

  useEffect(() => {
    if (!posts.length) return;
    const seen = viewedPostIdsRef.current;
    const pending = posts.filter((post) => post?._id && !seen.has(post._id));
    if (!pending.length) return;
    pending.forEach((post) => {
      seen.add(post._id);
      recordView(post._id);
    });
  }, [posts]);

  function goNextSegment() {
    if (!activeStorySegments.length) return;
    if (activeSegmentIndex + 1 < activeStorySegments.length) {
      setActiveSegmentIndex((prev) => prev + 1);
      return;
    }
    const nextOwnerIndex = activeOwnerIndex + 1;
    if (nextOwnerIndex < stories.length) {
      const nextStory = stories[nextOwnerIndex];
      setActiveOwnerIndex(nextOwnerIndex);
      setActiveStoryOwner(nextStory.ownerId);
      setActiveStoryIndex(0);
      setActiveSegmentIndex(0);
      setCommentText("");
      return;
    }
    closeStory();
  }

  function goPrevSegment() {
    if (!activeStorySegments.length) return;
    if (activeSegmentIndex > 0) {
      setActiveSegmentIndex((prev) => prev - 1);
      return;
    }
    const prevOwnerIndex = activeOwnerIndex - 1;
    if (prevOwnerIndex >= 0) {
      const prevStory = stories[prevOwnerIndex];
      const prevSegments = (() => {
        if (!prevStory) return [];
        const list = [];
        prevStory.items.forEach((ucut) => {
          if (ucut.type === "text") {
            list.push({ kind: "text", text: ucut.text || "Text story" });
            return;
          }
          const segments = Array.isArray(ucut.segments) ? ucut.segments : [];
          segments.forEach((segment) => {
            list.push({ kind: ucut.type, url: segment.url });
          });
        });
        return list;
      })();
      setActiveOwnerIndex(prevOwnerIndex);
      setActiveStoryOwner(prevStory.ownerId);
      setActiveStoryIndex(0);
      setActiveSegmentIndex(Math.max(0, prevSegments.length - 1));
      setCommentText("");
    }
  }

  async function handleCreatePost(postType = "upost") {
    if (!auth.token) {
      router.push("/login");
      return;
    }
    if (!mediaFile) {
      setStatus({ type: "error", message: "Media file is required." });
      return;
    }

    const mediaType = detectMediaType(mediaFile);
    if (!mediaType) {
      setStatus({ type: "error", message: "Unsupported media type." });
      return;
    }
    if (postType === "uclip" && mediaType !== "video") {
      setStatus({ type: "error", message: "UClips must be video only." });
      return;
    }

    const isLarge = mediaFile.size > LARGE_UPLOAD_BYTES;

    if (isLarge) {
      setStatus({ type: "loading", message: "Preparing large upload..." });
      const signatureResult = await apiRequest({
        path: "/api/uploads/signature",
        method: "POST",
        body: {
          folder: "mister/posts",
          resourceType: mediaType === "audio" ? "video" : mediaType,
        },
        token: auth.token,
      });
      if (!signatureResult.ok) {
        setStatus({
          type: "error",
          message: signatureResult.data?.error || "Failed to get upload signature.",
        });
        return;
      }

      const { cloudName, apiKey, timestamp, signature, folder, resourceType, publicId } =
        signatureResult.data || {};

      const uploadForm = new FormData();
      uploadForm.append("file", mediaFile);
      uploadForm.append("api_key", apiKey);
      uploadForm.append("timestamp", String(timestamp));
      uploadForm.append("signature", signature);
      if (folder) uploadForm.append("folder", folder);
      if (publicId) uploadForm.append("public_id", publicId);

      setStatus({ type: "loading", message: "Uploading large media..." });
      const uploadRes = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
        {
          method: "POST",
          body: uploadForm,
        },
      );
      const uploadData = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok) {
        setStatus({
          type: "error",
          message: uploadData?.error?.message || "Cloudinary upload failed.",
        });
        return;
      }

      const formData = {
        description: form.description || "",
        shareTargets: form.shareTargets || [],
        scheduledFor: form.scheduledFor || "",
        mediaUrl: uploadData.secure_url || uploadData.url,
        mediaType,
        postType,
      };
      setStatus({ type: "loading", message: "Creating post..." });
      const result = await apiRequest({
        path: "/api/posts",
        method: "POST",
        body: formData,
        token: auth.token,
      });
      if (!result.ok) {
        setStatus({
          type: "error",
          message: result.data?.error || "Post creation failed.",
        });
        return;
      }
      setStatus({
        type: "success",
        message: result.data?.message || "Post created successfully.",
      });
      setForm(emptyPost);
      setMediaFile(null);
      loadFeed(1, true);
      return;
    }

    const formData = new FormData();
    if (form.description) formData.append("description", form.description);
    if (form.shareTargets?.length) {
      formData.append("shareTargets", JSON.stringify(form.shareTargets));
    }
    if (form.scheduledFor) formData.append("scheduledFor", form.scheduledFor);
    if (postType) formData.append("postType", postType);
    formData.append("media", mediaFile);
    setStatus({ type: "loading", message: "Creating post..." });
    const result = await apiRequest({
      path: "/api/posts",
      body: formData,
      token: auth.token,
    });
    if (!result.ok) {
      setStatus({
        type: "error",
        message: result.data?.error || "Post creation failed.",
      });
      return;
    }
    setStatus({
      type: "success",
      message: result.data?.message || "Post created successfully.",
    });
    setForm(emptyPost);
    setMediaFile(null);
    loadFeed(1, true);
  }

  async function handleToggleLike(post) {
    if (!auth.token) return;
    const liked = post.viewerHasLiked;
    const result = await apiRequest({
      path: liked ? `/api/likes/${post._id}` : "/api/likes",
      method: liked ? "DELETE" : "POST",
      body: liked ? null : { postId: post._id },
      token: auth.token,
    });
    if (!result.ok) return;
    setPosts((prev) =>
      prev.map((item) => {
        if (item._id !== post._id) return item;
        const nextLiked = !liked;
        return {
          ...item,
          viewerHasLiked: nextLiked,
          likeCount: item.likeCount + (nextLiked ? 1 : -1),
        };
      }),
    );
  }

  async function handleToggleFollow(post) {
    if (!auth.token || !post.author?.id) return;
    const isFollowing = post.viewerIsFollowing;
    const result = await apiRequest({
      path: isFollowing ? `/api/follows/${post.author.id}` : "/api/follows",
      method: isFollowing ? "DELETE" : "POST",
      body: isFollowing ? null : { userId: post.author.id },
      token: auth.token,
    });
    if (!result.ok) return;
    setPosts((prev) =>
      prev.map((item) => {
        if (item.author?.id !== post.author.id) return item;
        return { ...item, viewerIsFollowing: !isFollowing };
      }),
    );
  }

  async function handleToggleSave(post) {
    if (!auth.token) return;
    const isSaved = post.viewerHasSaved;
    const result = await apiRequest({
      path: isSaved ? `/api/saved-posts/${post._id}` : "/api/saved-posts",
      method: isSaved ? "DELETE" : "POST",
      body: isSaved ? null : { postId: post._id },
      token: auth.token,
    });
    if (!result.ok) return;
    setPosts((prev) =>
      prev.map((item) =>
        item._id === post._id
          ? { ...item, viewerHasSaved: !isSaved }
          : item,
      ),
    );
  }

  async function handleLoadComments(post, page = 1) {
    if (!auth.token) return;
    setCommentsByPost((prev) => ({
      ...prev,
      [post._id]: {
        ...(prev[post._id] || { items: [], page: 0, totalPages: 1 }),
        loading: true,
      },
    }));
    const result = await apiRequest({
      path: `/api/comments?postId=${post._id}&page=${page}&limit=3`,
      method: "GET",
      token: auth.token,
    });
    if (!result.ok) {
      setCommentsByPost((prev) => ({
        ...prev,
        [post._id]: { ...(prev[post._id] || {}), loading: false },
      }));
      return;
    }
    setCommentsByPost((prev) => {
      const existing = prev[post._id]?.items || [];
      const items =
        page === 1 ? result.data.comments : [...existing, ...result.data.comments];
      return {
        ...prev,
        [post._id]: {
          items,
          page: result.data.page,
          totalPages: result.data.totalPages,
          loading: false,
        },
      };
    });
  }

  async function handleAddComment(post, text) {
    if (!auth.token) return;
    const result = await apiRequest({
      path: "/api/comments",
      body: { postId: post._id, text },
      token: auth.token,
    });
    if (!result.ok) return;
    setPosts((prev) =>
      prev.map((item) =>
        item._id === post._id
          ? { ...item, commentCount: item.commentCount + 1 }
          : item,
      ),
    );
    handleLoadComments(post, 1);
  }

  return (
    <PageShell
      title="Feed"
      subtitle="Create posts and navigate to your profile."
      actions={
        <>
          <Link className="btn ghost" href="/profile">
            Go to profile
          </Link>
          <button
            className="btn secondary"
            type="button"
            onClick={() => {
              clearAuth();
              router.push("/login");
            }}
          >
            Logout
          </button>
        </>
      }
    >
      <section className="card">
        <h2>{t("Stories")}</h2>
        {ucutError && <p className="error">{ucutError}</p>}
        {ucutLoading && <p>{t("Loading stories...")}</p>}
        {!ucutLoading && ucuts.length === 0 && <p>{t("No stories yet.")}</p>}
        {stories.length > 0 && (
          <div className="story-strip">
            {stories.map((story) => {
              const first = story.items[0];
              const firstSegment = Array.isArray(first?.segments)
                ? first.segments[0]
                : null;
              const owner = first?.owner || {};
              return (
                <button
                  className="story-card"
                  key={story.ownerId}
                  type="button"
                  onClick={() => openStory(story.ownerId, 0)}
                >
                  <div className="story-media">
                    {first?.type === "image" && firstSegment?.url && (
                      <img src={firstSegment.url} alt="UCut story" />
                    )}
                    {first?.type === "video" && firstSegment?.url && (
                      <video src={firstSegment.url} muted playsInline />
                    )}
                    {first?.type === "audio" && firstSegment?.url && (
                      <audio controls src={firstSegment.url} />
                    )}
                    {first?.type === "text" && (
                      <div className="story-text">
                        {first?.text || "Text story"}
                      </div>
                    )}
                  </div>
                  <p className="story-meta">
                    {owner?.name || owner?.username || story.ownerId}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </section>
      <section className="card">
        <div className="card-header">
          <h2>{t("Suggested artists")}</h2>
          <span className="muted">{suggestedArtists.length} total</span>
        </div>
        {suggestedError && <p className="error">{suggestedError}</p>}
        {suggestedLoading && <p>{t("Loading suggested artists...")}</p>}
        {!suggestedLoading && suggestedArtists.length === 0 && !suggestedError && (
          <p>{t("No suggested artists yet.")}</p>
        )}
        {suggestedArtists.length > 0 && (
          <div className="suggested-grid">
            {suggestedArtists.map((artist) => {
              const artistId = artist.id || artist._id;
              const displayName = artist.name || artist.username || "Artist";
              return (
                <div className="suggested-card" key={artistId}>
                  <div className="suggested-avatar">
                    {artist.profileImageUrl ? (
                      <img src={artist.profileImageUrl} alt={displayName} />
                    ) : (
                      <span>{displayName[0] || "A"}</span>
                    )}
                  </div>
                  <div className="suggested-info">
                    <div className="suggested-name">{displayName}</div>
                    {artist.username && <div className="suggested-handle">@{artist.username}</div>}
                    <div className="suggested-stats">
                      <span>{artist.followersCount || 0} followers</span>
                      <span>{artist.postsCount || 0} posts</span>
                    </div>
                  </div>
                  <div className="suggested-actions">
                    <Link className="btn ghost" href={`/users/${artistId}`}>
                      {t("View")}
                    </Link>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => handleFollowSuggested(artistId)}
                      disabled={suggestedFollowing.includes(artistId)}
                    >
                      {t("Follow")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      <CreatePostForm
        form={form}
        onChange={(event) => {
          const { name, value } = event.target;
          setForm((prev) => ({
            ...prev,
            [name]: value,
          }));
        }}
        onToggleTarget={(target) =>
          setForm((prev) => {
            const next = new Set(prev.shareTargets || []);
            if (next.has(target)) {
              next.delete(target);
            } else {
              next.add(target);
            }
            return { ...prev, shareTargets: Array.from(next) };
          })
        }
        onFileChange={(event) => setMediaFile(event.target.files?.[0] || null)}
        onSubmit={handleCreatePost}
        onSubmitPostType={handleCreatePost}
      />
      {feedError && (
        <section className="card">
          <h2>{t("Feed error")}</h2>
          <p className="error">{feedError}</p>
        </section>
      )}
      {posts.map((post) => (
        <PostCard
          key={post._id}
          post={post}
          currentUserId={auth.user?.id || auth.user?._id}
          onToggleFollow={handleToggleFollow}
          onToggleLike={handleToggleLike}
          onToggleSave={handleToggleSave}
          onOpenShare={setSharePost}
          commentsState={commentsByPost[post._id]}
          onLoadComments={handleLoadComments}
          onAddComment={handleAddComment}
        />
      ))}
      {feedLoading && (
        <section className="card">
          <h2>{t("Loading feed")}</h2>
          <p>{t("Fetching more posts...")}</p>
        </section>
      )}
      {feedPage < feedTotalPages && !feedLoading && (
        <section className="card">
          <button className="btn" type="button" onClick={() => loadFeed(feedPage + 1)}>
            {t("Load more posts")}
          </button>
        </section>
      )}
      {status && (
        <section className="card">
          <h2>{t("Status")}</h2>
          <p className={status.type === "error" ? "error" : ""}>
            {status.message}
          </p>
        </section>
      )}
      {activeUcut && (
        <div className="story-modal">
          <div className="story-modal-backdrop" onClick={closeStory} />
          <div className="story-modal-content">
            <div className="story-modal-header">
              <div className="story-owner">
                {activeOwner.profileImageUrl && (
                  <img src={activeOwner.profileImageUrl} alt={activeOwner.name} />
                )}
                <div>
                  <strong>{activeOwner.name || "Story"}</strong>
                  {activeOwner.username && (
                    <div className="muted">@{activeOwner.username}</div>
                  )}
                </div>
              </div>
              <button className="btn ghost" type="button" onClick={closeStory}>
                {t("Close")}
              </button>
            </div>
            <div className="story-modal-body">
              <button className="story-nav" type="button" onClick={goPrevSegment}>
                {t("Prev")}
              </button>
              <div className="story-stage">
                {activeStorySegments[activeSegmentIndex]?.kind === "image" && (
                  <img
                    src={activeStorySegments[activeSegmentIndex]?.url}
                    alt="UCut"
                  />
                )}
                {activeStorySegments[activeSegmentIndex]?.kind === "video" && (
                  <video
                    src={activeStorySegments[activeSegmentIndex]?.url}
                    controls
                    autoPlay
                  />
                )}
                {activeStorySegments[activeSegmentIndex]?.kind === "audio" && (
                  <audio
                    controls
                    autoPlay
                    src={activeStorySegments[activeSegmentIndex]?.url}
                  />
                )}
                {activeStorySegments[activeSegmentIndex]?.kind === "text" && (
                  <div className="story-text big">
                    {activeStorySegments[activeSegmentIndex]?.text || "Text story"}
                  </div>
                )}
              </div>
              <button className="story-nav" type="button" onClick={goNextSegment}>
                {t("Next")}
              </button>
            </div>
            <div className="story-modal-actions">
              <button className="btn ghost" type="button" onClick={handleToggleUcutLike}>
                {activeUcut.viewerHasLiked ? t("Unlike") : t("Like")} ({activeUcut.likeCount || 0})
              </button>
              <span className="muted">
                {activeUcut.commentCount || 0} {t("comments")}
              </span>
              {activeOwner?.id &&
                (activeOwner.id === auth.user?.id || activeOwner.id === auth.user?._id) && (
                  <button className="btn secondary" type="button" onClick={handleDeleteUcut}>
                    {t("Delete")}
                  </button>
                )}
            </div>
            <div className="story-modal-comments">
              {canComment ? (
                <>
                  <div className="comment-box">
                    <input
                      value={commentText}
                      onChange={(event) => setCommentText(event.target.value)}
                      placeholder={t("Write a comment...")}
                    />
                    <button
                      className="btn"
                      type="button"
                      onClick={handleAddUcutComment}
                      disabled={commentLoading}
                    >
                      {t("Send")}
                    </button>
                  </div>
                  <div className="comments">
                    {(ucutComments[activeUcut._id] || []).map((comment) => (
                      <div className="comment" key={comment._id}>
                        <div className="comment-avatar">U</div>
                        <div>
                          <div className="comment-author">Comment</div>
                          <div className="comment-text">{comment.text}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="muted">
                  {t("Comments are available only for mutual follows.")}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      <ShareModal
        open={Boolean(sharePost)}
        post={sharePost}
        token={auth.token}
        onClose={() => setSharePost(null)}
        onShared={({ action }) => {
          if (action === "feed") {
            loadFeed(1, true);
          }
          if (action === "ucuts") {
            loadUcuts();
    loadSuggestedArtists();
          }
        }}
      />
    </PageShell>
  );
}


