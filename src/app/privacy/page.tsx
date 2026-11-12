import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/legal/legal-page";
import { notFound } from "next/navigation";
import { LEGAL_PAGES_PUBLISHED } from "@/lib/preview";
import { NOINDEX } from "@/lib/site";

const TITLE = "Privacy Policy";
const DESCRIPTION = "Draft privacy policy for Orbitly, pending legal review. How Orbitly handles personal information during its early public preview.";

// noindex while this is a draft pending legal review; index it (and add it to the sitemap) once approved for publication.
export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: NOINDEX,
  alternates: { canonical: "/privacy" },
};

const SECTIONS: LegalSection[] = [
  {
    id: "about",
    title: "About this policy",
    body: (
      <>
        <p>
          Orbitly is a marketplace in early public preview. It connects people who want a product from another country (<strong>buyers</strong>) with
          people already making that journey (<strong>travellers</strong>), in both directions between India and other countries.
        </p>
        <p>
          This policy explains what personal information Orbitly handles, why, who it’s shared with and what choices you have. It covers the Orbitly
          website and the accounts created on it.
        </p>
        <p>
          <strong>Who operates Orbitly.</strong> The legal entity responsible for Orbitly, and its registered details, will be named here before this
          policy takes effect. They are not yet included in this draft.
        </p>
      </>
    ),
  },
  {
    id: "today",
    title: "What Orbitly does today",
    body: (
      <>
        <p>Orbitly is not fully open yet. Today:</p>
        <ul>
          <li>anyone can browse the public pages and illustrative example journeys;</li>
          <li>you can practise writing a product request, which stays in your own browser;</li>
          <li>where sign-ups are open, you can create an account and verify a phone number.</li>
        </ul>
        <p>
          Saving requests to an account, trips and offers between accounts, and payments are <strong>not available yet</strong>. Where this policy
          describes information those features would use, it says so.
        </p>
      </>
    ),
  },
  {
    id: "you-give",
    title: "Information you give us",
    body: (
      <>
        <h3>Account information</h3>
        <ul>
          <li>Your email address and password. Your password is handled by our authentication provider; Orbitly’s own code doesn’t store it.</li>
          <li>Your name, if you choose to add one.</li>
          <li>Whether you chose “Remember me” when signing in.</li>
        </ul>
        <h3>Email and phone verification</h3>
        <ul>
          <li>We send a link to your email address to confirm it, and to reset your password if you ask.</li>
          <li>
            Orbitly asks account holders to verify a mobile phone number. We send a one-time code by text message and record that the number was
            verified.
          </li>
        </ul>
        <h3>Product requests</h3>
        <ul>
          <li>
            <strong>Practice requests</strong> (available today) stay in your browser. The details you type and any photo you add aren’t uploaded to
            Orbitly.
          </li>
          <li>
            <strong>Product links.</strong> If you paste a link to a product page, Orbitly’s server visits that public page to read its title, image and
            description so we can fill in your request.
          </li>
          <li>
            <strong>Requests saved to an account</strong> (not available yet) would include what you describe: the product, its link and type,
            condition, quantity, listed price and budget, where you’d like it bought, the delivery city, when you need it, notes and an image.
          </li>
        </ul>
        <h3>Trips and offers (not available yet)</h3>
        <ul>
          <li>Trips: the countries you travel between, your travel dates, the space you have and any notes.</li>
          <li>
            Offers: your reward, an optional message, the product price and currency, your exchange rate, cost estimates (customs, delivery and
            other costs) with notes, your arrival date, the hand-over method, and your declaration about carrying the item lawfully.
          </li>
        </ul>
        <h3>Communications and support</h3>
        <p>An offer can include a short message to the buyer. Orbitly doesn’t yet have a support channel, so we don’t hold support messages.</p>
        <h3>Payment information</h3>
        <p>Orbitly doesn’t take payments, so it doesn’t collect card, bank or other payment details.</p>
      </>
    ),
  },
  {
    id: "automatic",
    title: "Information collected automatically",
    body: (
      <>
        <ul>
          <li>
            <strong>Sign-in cookies.</strong> Cookies keep you signed in. They’re described in “Cookies and browser storage” below.
          </li>
          <li>
            <strong>Security checks.</strong> On sign-up, sign-in, password reset and phone verification, a security check from Cloudflare (Turnstile)
            looks at information about your browser and device to tell people apart from automated abuse.
          </li>
          <li>
            <strong>Technical records.</strong> Our hosting and infrastructure providers process technical information, such as your IP address and the
            pages requested, to deliver the website and protect it. Orbitly’s own code records errors so we can fix them.
          </li>
          <li>
            <strong>Marketplace activity</strong> (not available yet): when the marketplace opens, actions such as publishing a request or sending or
            accepting an offer would be recorded with the time and the account that took them.
          </li>
        </ul>
        <p>Orbitly doesn’t use analytics, advertising or third-party tracking tools.</p>
      </>
    ),
  },
  {
    id: "use",
    title: "How we use information",
    body: (
      <>
        <p>We use personal information only for these purposes:</p>
        <ul>
          <li>creating and securing your account, and signing you in;</li>
          <li>verifying your email address and phone number;</li>
          <li>filling in a request from a product link you provide;</li>
          <li>when the marketplace opens, connecting buyers and travellers and managing requests, offers and journeys;</li>
          <li>preventing fraud and automated abuse, and keeping the service secure;</li>
          <li>finding and fixing problems with the service;</li>
          <li>meeting legal obligations that apply to us.</li>
        </ul>
        <p>Orbitly doesn’t sell personal information, and doesn’t use it for advertising.</p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Who we share information with",
    body: (
      <>
        <ul>
          <li>
            <strong>The other marketplace participant</strong> (when the marketplace opens): a buyer and a traveller see the details of the request or
            offer between them that they need to decide and arrange it.
          </li>
          <li>
            <strong>Service providers</strong> that run parts of Orbitly for us: Supabase (accounts, sign-in and database), Vercel (website hosting),
            Cloudflare (security checks) and the text-message service used to send verification codes. They process information to provide their
            service to Orbitly.
          </li>
          <li>
            <strong>Product websites.</strong> When Orbitly reads a product page for you, the shop sees a request from Orbitly’s server. We don’t send it
            your personal information.
          </li>
          <li>
            <strong>Delivery providers</strong>, in future and only where a delivery arrangement needs it.
          </li>
          <li>
            <strong>Payment providers</strong>, only if and when payments are enabled.
          </li>
          <li>
            <strong>Professional advisers</strong>, such as lawyers and accountants, where they need it to advise us.
          </li>
          <li>
            <strong>Authorities</strong>, where the law requires it.
          </li>
        </ul>
        <p>We share personal information only where it’s needed for the purpose and there is an appropriate legal basis.</p>
      </>
    ),
  },
  {
    id: "location",
    title: "Delivery location and addresses",
    body: (
      <>
        <ul>
          <li>
            <strong>City.</strong> A request asks only for a delivery city. Orbitly doesn’t ask for a full delivery address and has no field for one.
          </li>
          <li>
            <strong>Full address.</strong> A future delivery arrangement may need a full address. If it does, we’ll explain beforehand who would see it,
            and why.
          </li>
          <li>
            <strong>Travellers and delivery providers</strong> would receive location details only where needed to arrange delivery.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep information",
    body: (
      <>
        <p>We keep personal information only as long as it’s needed, judged by:</p>
        <ul>
          <li>whether your account is still active;</li>
          <li>whether the information is needed for an open request, offer or order, or a question about one;</li>
          <li>what the law requires us to keep, and for how long;</li>
          <li>security needs, such as investigating abuse.</li>
        </ul>
        <p>
          Specific retention periods haven’t been set yet and are part of the legal review of this draft. Information kept only in your browser
          (practice requests, your currency choice) stays there until you clear it. A product page Orbitly has read is remembered on our server for up
          to ten minutes, so repeat requests for the same link are quicker.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and browser storage",
    body: (
      <>
        <ul>
          <li>
            <strong>Sign-in cookies</strong> keep you signed in. Page scripts can’t read them. If you turn off “Remember me”, they end when you close
            your browser.
          </li>
          <li>
            <strong>A password-reset cookie</strong> is set only during a password reset, for a short time.
          </li>
          <li>
            <strong>Cloudflare’s security check</strong> runs on the sign-up, sign-in, password-reset and phone forms, under Cloudflare’s own terms.
          </li>
          <li>
            <strong>Browser storage</strong> holds your practice request drafts (until the tab closes), up to 20 saved practice requests, and your
            chosen display currency. These stay on your device.
          </li>
        </ul>
        <p>Orbitly doesn’t use cookies for analytics or advertising.</p>
      </>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <>
        <p>
          We use measures such as sign-in cookies that page scripts can’t read, secure connections, security headers on our pages, database rules
          that limit who can see what, and checks against automated abuse.
        </p>
        <p>No system is perfectly secure, and we can’t guarantee that information will never be accessed without permission.</p>
      </>
    ),
  },
  {
    id: "rights",
    title: "Your rights and choices",
    body: (
      <>
        <p>
          Depending on the law that applies to you, you may have rights to information about how your data is used, and to have it corrected,
          completed, updated or erased. You may also be able to raise a grievance and nominate someone to act for you.
        </p>
        <p>What you can do yourself today:</p>
        <ul>
          <li>
            change the name on your <Link href="/profile">profile</Link>;
          </li>
          <li>clear practice requests and preferences from your browser.</li>
        </ul>
        <p>
          Orbitly doesn’t yet offer a way to delete your account or change a verified phone number yourself, or a channel for other requests. Both will be in place, and described
          here, before this policy takes effect.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: <p>Eligibility requirements, including age, are being finalised as part of the legal review of this draft.</p>,
  },
  {
    id: "transfers",
    title: "Processing outside India",
    body: (
      <p>
        Some of our service providers may process information outside India. Where personal information is processed doesn’t depend on the direction
        a product travels. The locations involved, and the safeguards that apply, are being confirmed as part of the legal review of this draft.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: <p>We’ll update this page when the policy changes, and change the “last updated” date above.</p>,
  },
  {
    id: "contact",
    title: "Contact and grievances",
    body: (
      <p>
        Contact details for privacy questions, and for raising a grievance, will be published here before this policy takes effect. They are not yet
        available in this draft.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  // Drafts aren't public until legal review is complete: 404, with no draft text rendered.
  if (!LEGAL_PAGES_PUBLISHED) notFound();
  return (
    <LegalPage
      title={TITLE}
      intro={<p>How Orbitly handles personal information during its early public preview, and what will change as more of Orbitly opens.</p>}
      sections={SECTIONS}
      other={{ href: "/terms", label: "Terms & Conditions" }}
    />
  );
}
