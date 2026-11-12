export type NavLink = { href: string; label: string };

/** What the header knows about the signed-in user. Display only: pages and actions check the session themselves. */
export type HeaderAccount = { email: string; phoneVerified: boolean };

export const SIGNED_OUT_LINKS: NavLink[] = [
  { href: "/#start", label: "Shop" },
  { href: "/travel", label: "Travel" },
  { href: "/#how", label: "How it works" },
  { href: "/#trust", label: "Trust and safety" },
];

/** Account destinations. My requests and My trips appear only once those parts of the marketplace are open. */
export function accountLinks(requestsOpen: boolean, tripsOpen = false): NavLink[] {
  return [
    { href: "/#start", label: "New request" },
    { href: "/travel", label: "Travel" },
    ...(requestsOpen ? [{ href: "/requests", label: "My requests" }] : []),
    ...(tripsOpen ? [{ href: "/trips", label: "My trips" }] : []),
    { href: "/profile", label: "Profile" },
  ];
}
