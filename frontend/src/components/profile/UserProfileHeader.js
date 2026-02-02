export default function UserProfileHeader({
  user,
  profile,
  stats,
  mediaCounts,
  viewerIsFollowing,
  onToggleFollow,
  onMessage,
  isSelf,
}) {
  const name = profile?.displayName || user?.name || "User";
  const role = profile?.role || "Creator";
  const avatarUrl = profile?.profileImageUrl;
  const initials = name
    ? name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("")
    : "U";

  return (
    <section className="card profile-card">
      <div className="profile-header">
        <div className="profile-avatar">
          {avatarUrl ? <img src={avatarUrl} alt={name} /> : <span>{initials}</span>}
        </div>
        <div>
          <div className="profile-name">{name}</div>
          <div className="profile-role">{role}</div>
          {profile?.bio && <p className="muted">{profile.bio}</p>}
        </div>
        {!isSelf && (
          <div className="actions">
            <button className="btn ghost" type="button" onClick={onToggleFollow}>
              {viewerIsFollowing ? "Unfollow" : "Follow"}
            </button>
            {onMessage && (
              <button className="btn secondary" type="button" onClick={onMessage}>
                Message
              </button>
            )}
          </div>
        )}
      </div>
      <div className="stat-grid">
        <div className="stat">
          <span>Posts</span>
          <strong>{stats?.postsCount ?? 0}</strong>
        </div>
        <div className="stat">
          <span>Followers</span>
          <strong>{stats?.followersCount ?? 0}</strong>
        </div>
        <div className="stat">
          <span>Following</span>
          <strong>{stats?.followingCount ?? 0}</strong>
        </div>
        <div className="stat">
          <span>Images</span>
          <strong>{mediaCounts?.image ?? 0}</strong>
        </div>
        <div className="stat">
          <span>Videos</span>
          <strong>{mediaCounts?.video ?? 0}</strong>
        </div>
        <div className="stat">
          <span>Audio</span>
          <strong>{mediaCounts?.audio ?? 0}</strong>
        </div>
      </div>
    </section>
  );
}
