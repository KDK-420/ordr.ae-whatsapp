import Link from "next/link";

export const metadata = { title: "Settings" };

const SECTIONS = [
  { href: "/settings/templates", title: "WhatsApp templates", body: "Approved templates let the bot update customers after their 24 hour window closes." },
  { href: "/settings/staff", title: "Staff", body: "Who can sign in to this dashboard. Owners can add staff and reset passwords." },
  { href: "/settings/password", title: "Your password", body: "Change the password you sign in with." },
];

export default function SettingsPage() {
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Settings</h1>
      <div className="grid gap-4 md:grid-cols-3">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300">
            <h2 className="font-semibold">{s.title}</h2>
            <p className="mt-2 text-sm text-slate-600">{s.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
