import type { SVGProps } from "react";

/** Line icons for the suite, 24 px grid, drawn with the current text colour. */
const PATHS = {
  sale: "M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2M9 20.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Zm8 0a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Z",
  orders: "M7 3h10a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1Zm2 5h6M9 12h6M9 16h3",
  customers: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0M16 4.3a3.5 3.5 0 0 1 0 6.4M17.5 14.4A6 6 0 0 1 21 20",
  products: "M3 12.5V5a2 2 0 0 1 2-2h7.5L21 11.5 12.5 20 3 12.5ZM8 8h.01",
  inventory: "M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Zm0 0L12 12m0 0 8.5-4.5M12 12v9",
  reports: "M4 20V10m6 10V4m6 16v-7m5 7H2",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.2-1.3L14.5 3h-5l-.4 2.4a7.6 7.6 0 0 0-2.2 1.3l-2.3-.9-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.6l-2 1.5 2 3.4 2.3-.9c.7.6 1.4 1 2.2 1.3l.4 2.4h5l.4-2.4a7.6 7.6 0 0 0 2.2-1.3l2.3.9 2-3.4-2-1.5c.1-.4.1-.9.1-1.3Z",
  dashboard: "M4 4h7v9H4V4Zm9 0h7v5h-7V4Zm0 7h7v9h-7v-9Zm-9 4h7v5H4v-5Z",
  purchases: "M2 6h11v10H2V6Zm11 3h4l4 4v3h-8V9ZM6.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  suppliers: "M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16m0-11h5a1 1 0 0 1 1 1v10M2 21h20M8 8h2m-2 4h2m-2 4h2",
  adjustments: "M4 6h10m4 0h2M4 12h3m4 0h9M4 18h11m4 0h1M16 4v4M9 10v4m8 2v4",
  recipes: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm0 13a3 3 0 0 1 3-3h11M9 8h6",
  kitchen: "M12 3c1 3 4 4.5 4 8a4 4 0 0 1-8 0c0-1.5.5-2.5 1.5-3.5C9.5 9 11 8 12 3ZM6 21h12M8 17.5h8",
  store: "M4 9.5 5.5 4h13L20 9.5M4 9.5V20h16V9.5M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M9.5 20v-5.5h5V20",
  chat: "M4 5h16v11H9l-5 4V5Z",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4.5 4.5",
  close: "M6 6l12 12M18 6 6 18",
  down: "M6 9l6 6 6-6",
  right: "M9 6l6 6-6 6",
  left: "M15 6l-6 6 6 6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3 2",
  check: "M5 12.5 10 17.5 19.5 7",
  pause: "M8 5v14M16 5v14",
  card: "M3 6h18v12H3V6Zm0 4h18M7 15h3",
  cash: "M3 7h18v10H3V7Zm9 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6 10v4m12-4v4",
  trash: "M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13",
  logout: "M10 4H5v16h5M15 8l4 4-4 4M9 12h10",
  apps: "M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z",
  bag: "M5 8h14l-1 12H6L5 8Zm4 0V6a3 3 0 0 1 6 0v2",
  pin: "M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z",
  menu: "M4 7h16M4 12h16M4 17h16",
  alert: "M12 4 2.5 20h19L12 4Zm0 6v5m0 2.5v.01",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  expand: "M4 9V4h5M20 9V4h-5M4 15v5h5m11-5v5h-5",
  note: "M5 4h14v11l-5 5H5V4Zm9 16v-5h5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}
