import { useTranslations } from "../../lib/useTranslations";

export default function UpdateProfileForm({
  form,
  onChange,
  onFileChange,
  onSubmit,
}) {
  const labels = [
    "Update profile",
    "Edit profile details or replace the image.",
    "Username",
    "Display name",
    "Role",
    "Bio",
    "Instagram URL",
    "TikTok URL",
    "YouTube URL",
    "Facebook URL",
    "Spotify URL",
  ];
  const { t } = useTranslations(labels);

  return (
    <section className="card">
      <h2>{t("Update profile")}</h2>
      <p>{t("Edit profile details or replace the image.")}</p>
      <div className="row">
        <input
          name="username"
          value={form.username}
          onChange={onChange}
          placeholder={t("Username")}
        />
        <input
          name="displayName"
          value={form.displayName}
          onChange={onChange}
          placeholder={t("Display name")}
        />
        <input
          name="role"
          value={form.role}
          onChange={onChange}
          placeholder={t("Role")}
        />
      </div>
      <textarea name="bio" value={form.bio} onChange={onChange} placeholder={t("Bio")} />
      <div className="row">
        <input
          name="instagramUrl"
          value={form.instagramUrl}
          onChange={onChange}
          placeholder={t("Instagram URL")}
        />
        <input
          name="tiktokUrl"
          value={form.tiktokUrl}
          onChange={onChange}
          placeholder={t("TikTok URL")}
        />
      </div>
      <div className="row">
        <input
          name="youtubeUrl"
          value={form.youtubeUrl}
          onChange={onChange}
          placeholder={t("YouTube URL")}
        />
        <input
          name="facebookUrl"
          value={form.facebookUrl}
          onChange={onChange}
          placeholder={t("Facebook URL")}
        />
        <input
          name="spotifyArtistUrl"
          value={form.spotifyArtistUrl}
          onChange={onChange}
          placeholder={t("Spotify URL")}
        />
      </div>
      <input type="file" accept="image/*" onChange={onFileChange} />
      <div className="actions">
        <button className="btn" type="button" onClick={onSubmit}>
          Update profile
        </button>
      </div>
    </section>
  );
}
