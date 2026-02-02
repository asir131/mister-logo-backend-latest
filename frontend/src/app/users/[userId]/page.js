"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import PageShell from "../../../components/PageShell";
import UserProfileHeader from "../../../components/profile/UserProfileHeader";
import UserPostSection from "../../../components/profile/UserPostSection";
import { apiRequest } from "../../../lib/apiClient";
import { getAuth } from "../../../lib/authStore";

const emptySection = { items: [], page: 1, totalPages: 1, loading: false };

export default function UserProfilePage() {
  const router = useRouter();
  const params = useParams();
  const { userId } = params;
  const auth = getAuth();
  const [overview, setOverview] = useState(null);
  const [status, setStatus] = useState(null);
  const [sections, setSections] = useState({
    image: { ...emptySection },
    video: { ...emptySection },
    audio: { ...emptySection },
  });
  const [ucuts, setUcuts] = useState([]);
  const [ucutComments, setUcutComments] = useState({});
  const [ucutCommentText, setUcutCommentText] = useState({});
  const [ucutLoading, setUcutLoading] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [activeStoryOwner, setActiveStoryOwner] = useState(null);
  const [activeOwnerIndex, setActiveOwnerIndex] = useState(0);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0);

  useEffect(() => {
    if (!auth.token) {
      router.push("/login");
      return;
    }
    loadOverview();
    loadUcuts();
  }, [userId]);

  async function loadOverview() {
    setStatus({ type: "loading", message: "Loading profile..." });
    const result = await apiRequest({
      path: `/api/users/${userId}/overview`,
      method: "GET",
      token: auth.token,
    });
    if (!result.ok) {
      setStatus({
        type: "error",
        message: result.data?.error || "Failed to load profile.",
      });
      return;
    }
    setOverview(result.data);
    setStatus(null);
    loadPosts("image", 1, true);
    loadPosts("video", 1, true);
    loadPosts("audio", 1, true);
  }

  async function loadUcuts() {
    if (!userId) return;
    setUcutLoading(true);
    const result = await apiRequest({
      path: `/api/ucuts/user/${userId}`,
      method: "GET",
      token: auth.token,
    });
    setUcutLoading(false);
    if (!result.ok) return;
    setUcuts(result.data.ucuts || []);
  }

  async function handleToggleUcutLike(ucut) {
    if (!auth.token) return;
    if (ucut.owner?.id && (ucut.owner.id === auth.user?.id || ucut.owner.id === auth.user?._id)) {
      return;
    }
    const liked = ucut.viewerHasLiked;
    const result = await apiRequest({
      path: `/api/ucuts/${ucut._id}/like`,
      method: liked ? "DELETE" : "POST",
      token: auth.token,
    });
    if (!result.ok) return;
    setUcuts((prev) =>
      prev.map((item) =>
        item._id === ucut._id
          ? {
              ...item,
              viewerHasLiked: !liked,
              likeCount: item.likeCount + (!liked ? 1 : -1),
            }
          : item,
      ),
    );
  }

  async function loadUcutComments(ucutId) {
    if (!auth.token) return;
    const result = await apiRequest({
      path: `/api/ucuts/${ucutId}/comments?page=1&limit=10`,
      method: "GET",
      token: auth.token,
    });
    if (!result.ok) return;
    setUcutComments((prev) => ({ ...prev, [ucutId]: result.data.comments || [] }));
  }

  async function handleAddUcutComment(ucut) {
    if (!auth.token) return;
    if (ucut.owner?.id && (ucut.owner.id === auth.user?.id || ucut.owner.id === auth.user?._id)) {
      return;
    }
    const text = (ucutCommentText[ucut._id] || "").trim();
    if (!text) return;
    const result = await apiRequest({
      path: `/api/ucuts/${ucut._id}/comments`,
      method: "POST",
      body: { text },
      token: auth.token,
    });
    if (!result.ok) return;
    setUcutCommentText((prev) => ({ ...prev, [ucut._id]: "" }));
    loadUcutComments(ucut._id);
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
  }

  function closeStory() {
    setActiveStoryOwner(null);
    setActiveOwnerIndex(0);
    setActiveStoryIndex(0);
    setActiveSegmentIndex(0);
  }

  const activeStory = stories.find((story) => story.ownerId === activeStoryOwner);
  const activeUcut = activeStory?.items?.[activeStoryIndex] || null;
  const activeOwner = activeUcut?.owner || {};
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
  const activeSegmentUcutId = activeStorySegments[activeSegmentIndex]?.ucutId || null;
  const activeSegmentUcut = activeStory?.items?.find((item) => item._id === activeSegmentUcutId) || activeUcut;

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
    }
  }

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

  async function loadPosts(mediaType, page, replace) {
    setSections((prev) => ({
      ...prev,
      [mediaType]: { ...prev[mediaType], loading: true },
    }));
    const result = await apiRequest({
      path: `/api/users/${userId}/posts?mediaType=${mediaType}&page=${page}&limit=6`,
      method: "GET",
      token: auth.token,
    });
    if (!result.ok) {
      setSections((prev) => ({
        ...prev,
        [mediaType]: { ...prev[mediaType], loading: false },
      }));
      return;
    }
    setSections((prev) => {
      const existing = replace ? [] : prev[mediaType].items;
      return {
        ...prev,
        [mediaType]: {
          items: [...existing, ...result.data.posts],
          page: result.data.page,
          totalPages: result.data.totalPages,
          loading: false,
        },
      };
    });
  }

  async function handleToggleFollow() {
    if (!overview?.user?.id) return;
    const isFollowing = overview.viewerIsFollowing;
    const result = await apiRequest({
      path: isFollowing
        ? `/api/follows/${overview.user.id}`
        : "/api/follows",
      method: isFollowing ? "DELETE" : "POST",
      body: isFollowing ? null : { userId: overview.user.id },
      token: auth.token,
    });
    if (!result.ok) return;
    setOverview((prev) => ({
      ...prev,
      viewerIsFollowing: !isFollowing,
      stats: {
        ...prev.stats,
        followersCount: prev.stats.followersCount + (isFollowing ? -1 : 1),
      },
    }));
  }

  async function handleSendMessage() {
    if (!overview?.user?.id || !messageText.trim()) return;
    const result = await apiRequest({
      path: `/api/chats/${overview.user.id}/messages`,
      method: "POST",
      body: { text: messageText.trim() },
      token: auth.token,
    });
    if (!result.ok) return;
    setMessageText("");
    setMessageOpen(false);
    router.push("/chat");
  }

  const isSelf = auth.user?.id === overview?.user?.id || auth.user?._id === overview?.user?.id;

  return (
    <PageShell
      title="User profile"
      subtitle="Explore posts and profile statistics."
    >
      {overview && (
        <UserProfileHeader
          user={overview.user}
          profile={overview.profile}
          stats={overview.stats}
          mediaCounts={overview.mediaCounts}
          viewerIsFollowing={overview.viewerIsFollowing}
          onToggleFollow={handleToggleFollow}
          onMessage={() => setMessageOpen((prev) => !prev)}
          isSelf={isSelf}
        />
      )}
      {status && (
        <section className="card">
          <h2>Status</h2>
          <p className={status.type === "error" ? "error" : ""}>
            {status.message}
          </p>
        </section>
      )}
      {messageOpen && !isSelf && (
        <section className="card">
          <h2>Send a message</h2>
          <div className="comment-box">
            <input
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
              placeholder="Write a message..."
            />
            <button className="btn" type="button" onClick={handleSendMessage}>
              Send
            </button>
          </div>
        </section>
      )}
      <UserPostSection
        title="Image posts"
        posts={sections.image.items}
        loading={sections.image.loading}
        canLoadMore={sections.image.page < sections.image.totalPages}
        onLoadMore={() => loadPosts("image", sections.image.page + 1)}
      />
      <UserPostSection
        title="Video posts"
        posts={sections.video.items}
        loading={sections.video.loading}
        canLoadMore={sections.video.page < sections.video.totalPages}
        onLoadMore={() => loadPosts("video", sections.video.page + 1)}
      />
      <UserPostSection
        title="Audio posts"
        posts={sections.audio.items}
        loading={sections.audio.loading}
        canLoadMore={sections.audio.page < sections.audio.totalPages}
        onLoadMore={() => loadPosts("audio", sections.audio.page + 1)}
      />
      <section className="card">
        <h2>UCuts</h2>
        {ucutLoading && <p>Loading UCuts...</p>}
        {!ucutLoading && ucuts.length === 0 && <p>No UCuts yet.</p>}
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
                Close
              </button>
            </div>
            <div className="story-modal-body">
              <button className="story-nav" type="button" onClick={goPrevSegment}>
                Prev
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
                Next
              </button>
            </div>
            <div className="story-modal-actions">
              <button
                className="btn ghost"
                type="button"
                onClick={() => handleToggleUcutLike(activeSegmentUcut)}
                disabled={activeOwner?.id === auth.user?.id || activeOwner?.id === auth.user?._id}
              >
                {activeSegmentUcut?.viewerHasLiked ? "Unlike" : "Like"} ({activeSegmentUcut?.likeCount || 0})
              </button>
              <span className="muted">
                {activeSegmentUcut?.commentCount || 0} comments
              </span>
            </div>
            <div className="story-modal-comments">
              {activeOwner?.id !== auth.user?.id && activeOwner?.id !== auth.user?._id && (
                <div className="comment-box">
                  <input
                    value={ucutCommentText[activeSegmentUcut?._id] || ""}
                    onChange={(event) =>
                      setUcutCommentText((prev) => ({
                        ...prev,
                        [activeSegmentUcut?._id]: event.target.value,
                      }))
                    }
                    placeholder="Write a comment..."
                  />
                  <button
                    className="btn"
                    type="button"
                    onClick={() => handleAddUcutComment(activeSegmentUcut)}
                  >
                    Send
                  </button>
                </div>
              )}
              {(ucutComments[activeSegmentUcut?._id] || []).length > 0 && (
                <div className="comments">
                  {ucutComments[activeSegmentUcut?._id].map((comment) => (
                    <div className="comment" key={comment._id}>
                      <div className="comment-avatar">U</div>
                      <div>
                        <div className="comment-author">Comment</div>
                        <div className="comment-text">{comment.text}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
