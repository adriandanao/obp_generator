"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Official Business" },
  { href: "/leave", label: "Application for Leave" },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="tabs">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={path === t.href ? "on" : ""}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
