"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageShell from "../../components/PageShell";
import LoginForm from "../../components/forms/LoginForm";
import { apiRequest, getBaseUrl } from "../../lib/apiClient";
import { setAuth, setProfile, setProfileCompleted } from "../../lib/authStore";

const emptyLogin = { email: "", phoneNumber: "", password: "" };

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = useState(emptyLogin);
  const [status, setStatus] = useState(null);

  async function handleLogin() {
    setStatus({ type: "loading", message: "Logging in..." });
    const result = await apiRequest({
      path: "/api/auth/login",
      body: form,
    });
    if (!result.ok) {
      setStatus({
        type: "error",
        message: result.data?.error || "Login failed.",
      });
      return;
    }
    const authPayload = {
      user: result.data.user,
      token: result.data.token,
      refreshToken: result.data.refreshToken,
    };
    setAuth(authPayload);

    const profileResult = await apiRequest({
      path: "/api/profile/me",
      method: "GET",
      token: authPayload.token,
    });

    if (profileResult.ok) {
      setProfile(profileResult.data.profile);
      setProfileCompleted(true);
      router.push("/feed");
      return;
    }

    if (profileResult.status === 404) {
      setProfileCompleted(false);
      router.push("/complete-profile");
      return;
    }

    setStatus({
      type: "error",
      message: profileResult.data?.error || "Could not load profile.",
    });
  }

  function handleGoogleLogin() {
    const baseUrl = getBaseUrl();
    window.location.href = `${baseUrl}/api/auth/google/web`;
  }

  return (
    <PageShell
      title="Login"
      subtitle="Access the platform and continue your session."
      actions={
        params.get("verified")
          ? [
              <span className="pill" key="verified">
                Email verified. Please log in.
              </span>,
            ]
          : null
      }
    >
      <LoginForm
        form={form}
        onChange={(event) =>
          setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }))
        }
        onSubmit={handleLogin}
        onForgot={() => router.push("/forgot-password")}
        onRegister={() => router.push("/register")}
      />
      <section className="card">
        <button className="btn" type="button" onClick={handleGoogleLogin}>
          Continue with Google
        </button>
      </section>
      {status && (
        <section className="card">
          <h2>Status</h2>
          <p className={status.type === "error" ? "error" : ""}>
            {status.message}
          </p>
        </section>
      )}
    </PageShell>
  );
}
