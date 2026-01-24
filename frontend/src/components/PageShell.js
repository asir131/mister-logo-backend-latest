"use client";

import Link from "next/link";
import ApiConfigBar from "./ApiConfigBar";

export default function PageShell({ title, subtitle, actions, children }) {
  return (
    <div className="page">
      <header className="hero">
        <div>
          <div className="pill">Mister Logo Frontend</div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
          {actions && <div className="actions">{actions}</div>}
          <div className="actions">
            <Link className="btn ghost" href="/trending">
              Trending
            </Link>
            <Link className="btn ghost" href="/login">
              Login
            </Link>
            <Link className="btn ghost" href="/register">
              Register
            </Link>
          <Link className="btn ghost" href="/feed">
            Feed
          </Link>
          <Link className="btn ghost" href="/ublast">
            UBlast
          </Link>
          <Link className="btn ghost" href="/saved">
            Saved
          </Link>
          <Link className="btn ghost" href="/scheduled">
            Scheduled
          </Link>
          <Link className="btn ghost" href="/chat">
            Chat
          </Link>
          <Link className="btn ghost" href="/profile">
            Profile
          </Link>
          </div>
        </div>
        <ApiConfigBar />
      </header>
      <main className="grid">{children}</main>
    </div>
  );
}
