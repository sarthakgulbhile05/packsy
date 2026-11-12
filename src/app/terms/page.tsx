import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/legal/legal-page";
import { NOINDEX } from "@/lib/site";

const TITLE = "Terms & Conditions";
const DESCRIPTION = "Draft terms for using Orbitly, pending legal review. How requests, offers, estimates, customs and delivery will work.";

// noindex while this is a draft pending legal review; index it (and add it to the sitemap) once approved for publication.
export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: NOINDEX,
  alternates: { canonical: "/terms" },
};

const SECTIONS: LegalSection[] = [
  {
    id: "about",
    title: "About these terms",
    body: (
      <>
        <p>
          These terms describe how Orbitly works and the rules for using it. They are a draft: they haven’t been legally approved and aren’t yet in
          effect. The legal entity that operates Orbitly will be named here before they take effect.
        </p>
        <p>
          Orbitly is in early public preview. Several parts described below aren’t available yet, and each is marked. Where these terms describe how
          orders will work, they set out Orbitly’s approved direction, not a service that is running today.
        </p>
        <p>
          Our <Link href="/privacy">Privacy Policy</Link> explains how we handle personal information.
        </p>
      </>
    ),
  },
  {
    id: "roles",
    title: "Who does what",
    body: (
      <>
        <ul>
          <li>
            <strong>Buyers</strong> ask for a product from another country and decide whether to accept an offer.
          </li>
          <li>
            <strong>Travellers</strong> are people already making a journey who offer to buy a requested product and bring it with them.
          </li>
          <li>
            <strong>Orbitly</strong> provides the platform that connects buyers and travellers, shows offers and their costs, and coordinates the agreed
            arrangements. Orbitly doesn’t itself buy, sell or carry products.
          </li>
        </ul>
        <p>
          Responsibility for loss, damage, delay or failed delivery hasn’t been settled for any party yet and is part of the legal review of these
          terms. Nothing here takes away rights you have under law.
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    title: "Accounts and eligibility",
    body: (
      <>
        <ul>
          <li>Give accurate information when you create an account, and keep your password to yourself.</li>
          <li>Orbitly asks account holders to verify a mobile phone number after signing in.</li>
          <li>New accounts may be closed at times during the preview.</li>
        </ul>
        <p>Eligibility requirements, including age, identity checks and the countries Orbitly serves, haven’t been set yet.</p>
      </>
    ),
  },
  {
    id: "requests-offers",
    title: "Requests and offers",
    body: (
      <>
        <p>
          <strong>Available today:</strong> you can practise writing a request. It stays in your browser and isn’t sent to anyone.
        </p>
        <p>
          <strong>Not available yet:</strong> publishing requests, adding trips, and sending or accepting offers. When they open:
        </p>
        <ul>
          <li>a buyer describes the product they want and the delivery city, with a product link and budget where they have them;</li>
          <li>a traveller describes their trip and can send an offer on a matching request;</li>
          <li>an offer shows the traveller’s reward, the product price, and estimated customs, delivery and other costs, each as its own line;</li>
          <li>
            sending an offer doesn’t create an order. An order exists only when the buyer accepts the offer and every condition for acceptance below
            is met.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "prices",
    title: "Product prices and changes",
    body: (
      <ul>
        <li>The product price in an offer is an estimate, unless it has been independently verified as fixed.</li>
        <li>Before buying, the traveller provides evidence of the actual store price.</li>
        <li>If the actual price is higher than the price the buyer approved, the buyer must approve the new amount before the purchase goes ahead.</li>
        <li>Nothing extra is charged to the buyer automatically, and the traveller doesn’t automatically bear the difference.</li>
        <li>If the actual price is lower, the difference is reconciled openly and isn’t kept by Orbitly or the traveller.</li>
        <li>If the buyer declines a higher price, the order goes to review. A cancellation policy for this case hasn’t been written yet.</li>
      </ul>
    ),
  },
  {
    id: "customs",
    title: "Customs",
    body: (
      <>
        <ul>
          <li>Actual, documented customs costs are a cost for the buyer.</li>
          <li>Customs is shown as its own estimated cost, together with how uncertain the estimate is.</li>
          <li>Before accepting, the buyer explicitly agrees to a separately shown maximum customs amount. It’s a limit on what the buyer agrees to, not a guarantee of the actual duty.</li>
          <li>Anything above that maximum needs the buyer’s fresh approval. Nothing above it is charged automatically.</li>
          <li>The traveller isn’t automatically responsible for a customs shortfall.</li>
          <li>Customs money is never Orbitly’s revenue.</li>
          <li>An order isn’t accepted unless a lawful and practical customs route exists for that journey.</li>
        </ul>
        <p>
          Who is legally responsible for customs, who the importer is, who pays and how, and the procedure in each country all depend on the law that
          applies, and are still being verified. Orbitly doesn’t promise customs clearance or any customs outcome. Personal baggage allowances aren’t
          assumed to apply to products bought for someone else.
        </p>
      </>
    ),
  },
  {
    id: "delivery",
    title: "Delivery",
    body: (
      <>
        <h3>Costs</h3>
        <ul>
          <li>Genuine delivery costs are a cost for the buyer, shown separately from the product price and the traveller’s reward.</li>
          <li>Local transport, courier, packaging and handling costs are listed separately where they apply.</li>
          <li>Delivery estimates aren’t guaranteed prices.</li>
          <li>A cost above the agreed estimate needs the buyer’s explicit approval before it’s incurred or charged. Nothing extra is charged automatically.</li>
          <li>If the buyer declines a higher delivery cost, the traveller isn’t automatically responsible for it.</li>
        </ul>
        <h3>Arranging delivery</h3>
        <ul>
          <li>The buyer gives the delivery city and a preferred delivery method.</li>
          <li>The traveller says whether that method is practical for their journey.</li>
          <li>Before an order can be accepted, a workable delivery method must be confirmed and the buyer must approve the delivery costs.</li>
          <li>If delivery is uncertain, for example because information is missing or a traveller hasn’t answered, the order stays pending. Silence is never treated as a refusal.</li>
          <li>If no lawful and practical delivery method can be arranged, the order can’t be accepted.</li>
          <li>Confirming that a method is practical isn’t a courier booking, and no booking or extra cost is made without the required approval.</li>
          <li>Orbitly coordinates the agreed arrangement and records its progress.</li>
        </ul>
        <h3>Paying a delivery provider directly</h3>
        <p>
          In future, a buyer may be able to pay a delivery provider directly, but only where that provider supports it and the arrangement has been
          verified as lawful and practical. That payment would be between the buyer and the provider, outside Orbitly, and isn’t part of the traveller’s
          reward or Orbitly’s fees.
        </p>
        <h3>What Orbitly doesn’t promise</h3>
        <p>
          Orbitly doesn’t guarantee courier acceptance, pickup, delivery dates, successful delivery or the condition of a product. Orbitly has no courier
          integration, shipment tracking, insurance or returns service.
        </p>
      </>
    ),
  },
  {
    id: "fees",
    title: "Traveller reward and Orbitly’s fees",
    body: (
      <>
        <p>Each of these will be shown separately in an offer:</p>
        <ul>
          <li>the product price, which reimburses what the product actually costs;</li>
          <li>the traveller’s reward, agreed in the offer;</li>
          <li>customs and delivery costs, as described above.</li>
        </ul>
        <p>
          <strong>Orbitly’s fees, not currently charged.</strong> Orbitly’s approved pricing is a buyer fee of 3% of the agreed product
          estimate, and a fee of 10% of the traveller’s agreed reward, taken from that reward, so the traveller receives 90% of it. The 10% fee is
          never taken from the product price, customs or delivery costs, and no Orbitly fee is added to customs or delivery costs or to an approved
          extra payment. There’s no currency-conversion margin or other hidden charge. Because Orbitly doesn’t take payments yet, no fee is collected.
        </p>
      </>
    ),
  },
  {
    id: "payments",
    title: "Payments",
    body: (
      <>
        <p>
          <strong>Orbitly doesn’t take or process payments.</strong> It doesn’t hold anyone’s money, doesn’t offer escrow or buyer protection, and
          doesn’t make refunds or payouts.
        </p>
        <p>
          If payments are introduced, they’ll be handled through a regulated payment provider, and these terms will be updated to describe how they
          work before anyone is asked to pay.
        </p>
      </>
    ),
  },
  {
    id: "problems",
    title: "Cancellations, problems and disputes",
    body: (
      <>
        <p>
          Orbitly hasn’t yet written its policies on cancellations, refunds, failed or late deliveries, lost or damaged products, or disputes. Until it
          has, a problem with an order goes to review by Orbitly, and no outcome is decided automatically.
        </p>
        <p>These terms don’t affect any rights you have under consumer protection or other law.</p>
      </>
    ),
  },
  {
    id: "conduct",
    title: "Acceptable use",
    body: (
      <ul>
        <li>Don’t ask for, offer to carry or deliver anything that is unlawful to buy, export, import or carry on the route involved.</li>
        <li>Give accurate information in requests, trips and offers, including prices and costs.</li>
        <li>Don’t impersonate anyone, mislead other users, or attempt fraud.</li>
        <li>Don’t misuse the service, for example by interfering with its security, using automated tools against it, or collecting other users’ data.</li>
        <li>Only submit content, such as links, descriptions and photos, that you’re entitled to share.</li>
      </ul>
    ),
  },
  {
    id: "content",
    title: "Content you submit",
    body: (
      <p>
        You remain responsible for what you submit. You allow Orbitly to store and show it as needed to run the service, for example to show your
        request to travellers once publishing is available.
      </p>
    ),
  },
  {
    id: "access",
    title: "Limiting access",
    body: (
      <p>
        Orbitly may limit or suspend access to protect users or the service, or where the law requires it. The process for this is part of the legal
        review of these terms.
      </p>
    ),
  },
  {
    id: "responsibility",
    title: "Orbitly’s responsibility",
    body: (
      <p>
        Orbitly is in early preview and makes no promise that the service will always be available or free of errors. How responsibility is shared
        between buyers, travellers and Orbitly is still being settled with legal advice. Nothing in these terms limits any responsibility that can’t be
        limited under law.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: <p>We’ll update this page when these terms change, and change the “last updated” date above.</p>,
  },
  {
    id: "law",
    title: "Governing law, disputes and notices",
    body: <p>The governing law, how disputes are resolved, and where notices are sent haven’t been decided yet. They’ll be set out here before these terms take effect.</p>,
  },
  {
    id: "contact",
    title: "Contact and grievances",
    body: <p>Contact details, including for raising a grievance, will be published here before these terms take effect. They are not yet available in this draft.</p>,
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title={TITLE}
      intro={<p>The rules for using Orbitly, and how requests, offers, customs and delivery will work as the marketplace opens.</p>}
      sections={SECTIONS}
      other={{ href: "/privacy", label: "Privacy Policy" }}
    />
  );
}
