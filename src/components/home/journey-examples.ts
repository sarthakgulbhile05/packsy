import type { Journey } from "@/lib/journey";
import blockPrintCotton from "../../../public/journeys/block-print-cotton.jpg";
import coffeeGrinder from "../../../public/journeys/coffee-grinder.jpg";
import embroideredShawl from "../../../public/journeys/embroidered-shawl.jpg";
import headphones from "../../../public/journeys/headphones.jpg";
import sneakers from "../../../public/journeys/sneakers.jpg";
import woodenElephant from "../../../public/journeys/wooden-elephant.jpg";

// ILLUSTRATIVE ONLY. No real people, orders, prices or savings: the page labels these as examples, and no
// example party is marked phone-verified. Replace with completed deliveries from Supabase once they exist.
// Photos: Unsplash License (free for commercial use) — headphones by Kamran Abdullayev (TpDhqQCWY0s),
// sneaker by Luis Felipe Lins (LG88A2XgIXY), coffee grinder by Ashkan Forouzani (UstAaR0YnnI), block-printed
// fabric by Esha Verma (pv30rD5KqsM), embroidered shawls by Richard Williams (xLQEPpuonWY), wooden elephant by
// asif sharif (TgMoDrvKZls). Three examples travel into India and three out of it; the page shows both equally.
// Local prices abroad are converted to rupees at rough, illustrative rates.
export const EXAMPLE_JOURNEYS: Journey[] = [
  {
    id: "example-headphones",
    status: "delivered",
    product: {
      name: "Wireless over-ear headphones",
      detail: "UK model · 1 pair",
      image: { src: headphones, alt: "Wireless over-ear headphones in cream and graphite" },
    },
    buyer: { city: "Mumbai", country: "India", phoneVerified: false },
    traveller: { city: "London", country: "UK", phoneVerified: false },
    productPriceInr: 24_900,
    travellerFeeInr: 1_800,
    localPriceInr: 32_990,
    steps: [
      { label: "Buyer shared a product link", when: "Day 1" },
      { label: "Traveller’s offer accepted", when: "Day 2" },
      { label: "Bought in London", when: "Day 6" },
      { label: "Landed in Mumbai", when: "Day 9" },
      { label: "Handed over in person", when: "Day 10" },
    ],
  },
  {
    id: "example-sneakers",
    status: "delivered",
    product: {
      name: "Running sneakers",
      detail: "Japan release · UK 9",
      image: { src: sneakers, alt: "White and orange running sneaker on a plain background" },
    },
    buyer: { city: "Bengaluru", country: "India", phoneVerified: false },
    traveller: { city: "Tokyo", country: "Japan", phoneVerified: false },
    productPriceInr: 11_200,
    travellerFeeInr: 1_200,
    localPriceInr: 16_995,
    steps: [
      { label: "Buyer added a photo and size", when: "Day 1" },
      { label: "Traveller’s offer accepted", when: "Day 3" },
      { label: "Bought in Tokyo", when: "Day 5" },
      { label: "Landed in Bengaluru", when: "Day 8" },
      { label: "Handed over in person", when: "Day 8" },
    ],
  },
  {
    id: "example-coffee-grinder",
    status: "delivered",
    product: {
      name: "Hand-crank coffee grinder",
      detail: "Wooden body · 1 unit",
      image: { src: coffeeGrinder, alt: "Wooden hand-crank coffee grinder with coffee beans" },
    },
    buyer: { city: "Delhi", country: "India", phoneVerified: false },
    traveller: { city: "Milan", country: "Italy", phoneVerified: false },
    productPriceInr: 2_800,
    travellerFeeInr: 900,
    localPriceInr: 5_500,
    steps: [
      { label: "Buyer described the item", when: "Day 1" },
      { label: "Traveller’s offer accepted", when: "Day 2" },
      { label: "Bought in Milan", when: "Day 4" },
      { label: "Landed in Delhi", when: "Day 7" },
      { label: "Handed over in person", when: "Day 8" },
    ],
  },
  {
    id: "example-block-print",
    status: "delivered",
    product: {
      name: "Hand-block-printed cotton",
      detail: "Indigo and natural dyes · 3 metres",
      image: { src: blockPrintCotton, alt: "Hand-block-printed cotton fabrics in indigo, green and ochre hanging in a row" },
    },
    buyer: { city: "London", country: "UK", phoneVerified: false },
    traveller: { city: "Mumbai", country: "India", phoneVerified: false },
    productPriceInr: 2_400,
    travellerFeeInr: 1_500,
    localPriceInr: 6_600,
    steps: [
      { label: "Buyer shared a photo of the print", when: "Day 1" },
      { label: "Traveller’s offer accepted", when: "Day 2" },
      { label: "Bought in Mumbai", when: "Day 4" },
      { label: "Landed in London", when: "Day 6" },
      { label: "Handed over in person", when: "Day 7" },
    ],
  },
  {
    id: "example-shawl",
    status: "delivered",
    product: {
      name: "Hand-embroidered wool shawl",
      detail: "Chain-stitch embroidery · 1 shawl",
      image: { src: embroideredShawl, alt: "Wool shawls with colourful hand-embroidered floral patterns" },
    },
    buyer: { city: "Dubai", country: "UAE", phoneVerified: false },
    traveller: { city: "Delhi", country: "India", phoneVerified: false },
    productPriceInr: 6_500,
    travellerFeeInr: 1_500,
    localPriceInr: 10_400,
    steps: [
      { label: "Buyer described the colours they wanted", when: "Day 1" },
      { label: "Traveller’s offer accepted", when: "Day 2" },
      { label: "Bought in Delhi", when: "Day 3" },
      { label: "Landed in Dubai", when: "Day 5" },
      { label: "Handed over in person", when: "Day 5" },
    ],
  },
  {
    id: "example-wooden-elephant",
    status: "delivered",
    product: {
      name: "Hand-carved wooden elephant",
      detail: "Solid wood · 20 cm",
      image: { src: woodenElephant, alt: "Hand-carved, polished wooden elephant figurine with its trunk raised" },
    },
    buyer: { city: "Singapore", country: "Singapore", phoneVerified: false },
    traveller: { city: "Bengaluru", country: "India", phoneVerified: false },
    productPriceInr: 3_200,
    travellerFeeInr: 1_200,
    localPriceInr: 7_800,
    steps: [
      { label: "Buyer shared a product link", when: "Day 1" },
      { label: "Traveller’s offer accepted", when: "Day 3" },
      { label: "Bought in Bengaluru", when: "Day 5" },
      { label: "Landed in Singapore", when: "Day 7" },
      { label: "Handed over in person", when: "Day 8" },
    ],
  },
];
