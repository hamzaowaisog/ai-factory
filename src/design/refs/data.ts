// Reference data for the design step: how real products in a field are coloured and shaped.
// Every colour here is REPORTED (read from brand pages and aggregator sites, rounded, and sometimes
// in conflict between sources), not measured. `factory design refs measure` reads the live sites and
// writes an overlay that wins over these values (see refs/index.ts). Add an industry or a brand here;
// the tests check the shape.
import { z } from "zod";

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const RefBrand = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  /** page the measuring command opens (a marketing or booking home page, phone viewport) */
  site: z.string().url(),
  brand: Hex,
  accent: Hex.optional(),
  mode: z.enum(["light", "dark"]).default("light"),
  /** app bar filled with the brand colour, or plain white/dark */
  chrome: z.enum(["brand", "plain"]),
  radius: z.enum(["sharp", "soft", "round"]),
  /** one short phrase on what makes it recognisable */
  trait: z.string().max(90),
});
export type RefBrand = z.infer<typeof RefBrand>;

export const RefIndustry = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string(),
  /** words in a requirement that point at this field (matched as whole words, case-insensitive) */
  keywords: z.array(z.string().min(2)).min(3),
  brands: z.array(RefBrand).min(3),
  /** what the field has in common, and what to vary, in two or three sentences */
  pattern: z.string().max(420),
  /** the theme fields the field usually shares (a starting point, not a rule) */
  usual: z.object({
    mode: z.enum(["light", "dark"]), chrome: z.enum(["brand", "plain"]), neutral: z.enum(["cool", "warm", "pure"]),
    font: z.enum(["sans", "humanist", "serif", "rounded"]), radius: z.enum(["sharp", "soft", "round"]),
    density: z.enum(["comfortable", "compact"]), surface: z.enum(["flat", "soft", "glass"]),
  }),
});
export type RefIndustry = z.infer<typeof RefIndustry>;

type B = Omit<z.input<typeof RefBrand>, "mode"> & { mode?: "light" | "dark" };
const b = (id: string, name: string, site: string, brand: string, chrome: "brand" | "plain", radius: "sharp" | "soft" | "round", trait: string, extra: { accent?: string; mode?: "dark" } = {}): B =>
  ({ id, name, site, brand, chrome, radius, trait, ...extra });

const RAW = [
  {
    id: "airline", label: "Airlines",
    keywords: ["airline", "flight", "flights", "boarding", "airport", "baggage", "itinerary", "fare", "fares", "aircraft", "pnr", "check-in", "cabin"],
    brands: [
      b("delta", "Delta", "https://www.delta.com", "#E3132C", "plain", "soft", "red and deep navy on white; red for actions, navy for headings", { accent: "#003268" }),
      b("united", "United", "https://www.united.com", "#1414D2", "plain", "soft", "bright blue actions on white, navy text", { accent: "#002244" }),
      b("american", "American", "https://www.aa.com", "#13AFEB", "plain", "soft", "slate grey with a sky-blue action and a red accent", { accent: "#DE1B23" }),
      b("emirates", "Emirates", "https://www.emirates.com", "#D71A21", "brand", "sharp", "deep red livery bar, gold touches, large photography"),
      b("lufthansa", "Lufthansa", "https://www.lufthansa.com", "#05164D", "brand", "sharp", "navy bar with one yellow action (reported navy values differ)", { accent: "#FFAD00" }),
      b("qatar", "Qatar Airways", "https://www.qatarairways.com", "#660033", "brand", "soft", "burgundy bar, quiet white cards, silver text"),
    ],
    pattern: "Livery colour (red, navy or burgundy) as the app bar or the primary button, white cards, a boarding-pass style detail with a large route (origin, arrow, destination), times in a heavy weight and status chips for on time, delayed and gate change. Airlines differ in whether the bar is filled and how sharp the corners are; pick one livery and keep every other surface neutral.",
    usual: { mode: "light", chrome: "brand", neutral: "cool", font: "sans", radius: "soft", density: "comfortable", surface: "flat" },
  },
  {
    id: "bank", label: "Banks and cards",
    keywords: ["bank", "banking", "account", "accounts", "balance", "statement", "statements", "transfer", "iban", "card", "cards", "loan", "mortgage", "deposit", "transactions"],
    brands: [
      b("chase", "Chase", "https://www.chase.com", "#117ACA", "plain", "soft", "one clear blue on white, figures large and plain"),
      b("bofa", "Bank of America", "https://www.bankofamerica.com", "#012169", "plain", "sharp", "navy with a red accent, flag-like and formal", { accent: "#E31837" }),
      b("wells", "Wells Fargo", "https://www.wellsfargo.com", "#D71E28", "brand", "sharp", "red bar with a yellow highlight", { accent: "#FFCD41" }),
      b("capone", "Capital One", "https://www.capitalone.com", "#004879", "plain", "soft", "dark blue with a red mark, white page", { accent: "#D22E1E" }),
      b("hsbc", "HSBC", "https://www.hsbc.com", "#EE3524", "plain", "sharp", "red on white and black text, very restrained"),
    ],
    pattern: "Calm, near-white pages, one deep brand colour, tabular figures, status colour only for the money moving (green in, red out or alert). No decoration around balances. Banks differ mainly in the brand hue and corner sharpness; keep the page white and the type plain.",
    usual: { mode: "light", chrome: "plain", neutral: "cool", font: "sans", radius: "soft", density: "comfortable", surface: "flat" },
  },
  {
    id: "fintech", label: "Fintech and payments",
    keywords: ["fintech", "payment", "payments", "wallet", "invoice", "invoices", "checkout", "remittance", "crypto", "trading", "invest", "investing", "portfolio", "budget", "savings"],
    brands: [
      b("revolut", "Revolut", "https://www.revolut.com", "#494FDF", "plain", "round", "violet-blue on white or black, big numerals"),
      b("wise", "Wise", "https://wise.com", "#9FE870", "plain", "round", "fresh green on dark forest text, friendly and plain", { accent: "#163300" }),
      b("cashapp", "Cash App", "https://cash.app", "#00D533", "brand", "round", "saturated green and black, one number per screen"),
      b("stripe", "Stripe", "https://stripe.com", "#635BFF", "plain", "soft", "blurple on white with dark navy text, dense dashboards"),
      b("robinhood", "Robinhood", "https://robinhood.com", "#CCFF00", "plain", "soft", "near-black or white with neon chartreuse used once", { mode: "dark" }),
      b("monzo", "Monzo", "https://monzo.com", "#FF4F40", "brand", "round", "hot coral and deep navy, playful cards"),
    ],
    pattern: "A single bold colour, large numerals and a lot of white or black space; the money figure is the hero. Charts use one line colour with a muted grid. Fintechs differ in energy: dashboards for business (Stripe) are dense and cool, consumer apps (Cash App, Monzo) are loud and round.",
    usual: { mode: "light", chrome: "plain", neutral: "cool", font: "sans", radius: "round", density: "comfortable", surface: "soft" },
  },
  {
    id: "health", label: "Health and care",
    keywords: ["patient", "patients", "clinic", "clinical", "doctor", "appointment", "appointments", "prescription", "hospital", "medical", "health", "healthcare", "telehealth", "ehr", "care"],
    brands: [
      b("cleveland", "Cleveland Clinic", "https://my.clevelandclinic.org", "#0065A9", "plain", "soft", "calm blue with a green accent on white", { accent: "#1A7C40" }),
      b("mayo", "Mayo Clinic", "https://www.mayoclinic.org", "#012D61", "plain", "sharp", "deep navy with a warm yellow highlight", { accent: "#FFC846" }),
      b("kaiser", "Kaiser Permanente", "https://healthy.kaiserpermanente.org", "#0072CE", "plain", "soft", "plain blue on white, generous space"),
      b("zocdoc", "Zocdoc", "https://www.zocdoc.com", "#FFB900", "plain", "round", "friendly yellow on white, big search"),
      b("onemedical", "One Medical", "https://www.onemedical.com", "#1F4F4B", "plain", "round", "deep green and cream, warm and unhurried"),
    ],
    pattern: "Soft blues and greens on white, large readable type, plenty of space, and status colours kept for clinical meaning (urgent, due, done). Never alarm-red as decoration. Brands differ in warmth: hospital systems are blue and formal, newer care apps are green or cream and round.",
    usual: { mode: "light", chrome: "plain", neutral: "cool", font: "humanist", radius: "soft", density: "comfortable", surface: "flat" },
  },
  {
    id: "retail", label: "Retail and marketplaces",
    keywords: ["shop", "store", "cart", "catalog", "catalogue", "product", "products", "ecommerce", "e-commerce", "marketplace", "order", "orders", "wishlist", "sku", "inventory", "merchant"],
    brands: [
      b("amazon", "Amazon", "https://www.amazon.com", "#FF9900", "plain", "soft", "dark navy bar, orange action, very dense results", { accent: "#232F3E" }),
      b("walmart", "Walmart", "https://www.walmart.com", "#0071CE", "brand", "round", "blue bar, yellow spark, big price text", { accent: "#FFC220" }),
      b("target", "Target", "https://www.target.com", "#CC0000", "plain", "round", "red on white, clean grid of images"),
      b("ikea", "IKEA", "https://www.ikea.com", "#0058A3", "plain", "sharp", "blue and yellow on white, plain product grid", { accent: "#FFDB00" }),
      b("etsy", "Etsy", "https://www.etsy.com", "#F56400", "plain", "round", "warm orange with serif touches, image-led"),
      b("zara", "Zara", "https://www.zara.com", "#000000", "plain", "sharp", "black and white only, huge photography, tiny type", {}),
    ],
    pattern: "White pages, big product imagery and one warm high-energy action colour (orange, red or blue) on the buy button. Price is the heaviest text. Marketplaces are dense with filters; fashion brands go minimal in black and white. Choose where on that range the product sits.",
    usual: { mode: "light", chrome: "plain", neutral: "warm", font: "sans", radius: "round", density: "comfortable", surface: "soft" },
  },
  {
    id: "food", label: "Food delivery and restaurants",
    keywords: ["restaurant", "restaurants", "menu", "delivery", "courier", "rider", "meal", "meals", "food", "grocery", "recipe", "kitchen", "reservation", "dish"],
    brands: [
      b("ubereats", "Uber Eats", "https://www.ubereats.com", "#06C167", "plain", "round", "black and white with one green, photo-led cards"),
      b("doordash", "DoorDash", "https://www.doordash.com", "#FF3008", "plain", "round", "red-orange on white, rounded cards"),
      b("grubhub", "Grubhub", "https://www.grubhub.com", "#F63440", "plain", "soft", "red on white"),
      b("deliveroo", "Deliveroo", "https://deliveroo.co.uk", "#00CCBC", "brand", "round", "teal bar, friendly illustration"),
      b("swiggy", "Swiggy", "https://www.swiggy.com", "#FC8019", "plain", "soft", "orange accents, dense restaurant lists"),
      b("zomato", "Zomato", "https://www.zomato.com", "#CB202D", "plain", "round", "deep red, photo cards, warm greys"),
    ],
    pattern: "One warm, appetising colour (red, orange or green) on a white page, with photography doing the work and a clear ETA or price on each card. Courier status is a timeline with one current step highlighted. Brands differ in hue, not layout.",
    usual: { mode: "light", chrome: "plain", neutral: "warm", font: "rounded", radius: "round", density: "comfortable", surface: "soft" },
  },
  {
    id: "travel", label: "Travel, stays and bookings",
    keywords: ["hotel", "hotels", "booking", "bookings", "stay", "stays", "room", "rooms", "guest", "guests", "resort", "holiday", "trip", "trips", "rental", "check-out"],
    brands: [
      b("booking", "Booking.com", "https://www.booking.com", "#003580", "brand", "soft", "deep blue bar, white search box, yellow-bordered search button", { accent: "#FEBA02" }),
      b("airbnb", "Airbnb", "https://www.airbnb.com", "#FF385C", "plain", "round", "white page, huge photos, one coral action, charcoal text", { accent: "#222222" }),
      b("expedia", "Expedia", "https://www.expedia.com", "#1E243A", "brand", "soft", "navy with a yellow call to action", { accent: "#FEBF4F" }),
      b("marriott", "Marriott", "https://www.marriott.com", "#72152B", "plain", "sharp", "burgundy with a serif feel, formal"),
      b("hilton", "Hilton", "https://www.hilton.com", "#003087", "plain", "soft", "royal navy on white, quiet imagery"),
      b("hyatt", "Hyatt", "https://www.hyatt.com", "#4B77A9", "plain", "sharp", "muted blue and generous white, editorial"),
    ],
    pattern: "Photography first, a prominent search form near the top, price per night in bold, and one action colour. Marketplaces (Airbnb) go white and round; chains (Marriott, Hilton) go formal with a deep brand colour. Show dates, guests and totals in the same layout everywhere.",
    usual: { mode: "light", chrome: "plain", neutral: "warm", font: "sans", radius: "soft", density: "comfortable", surface: "soft" },
  },
  {
    id: "mobility", label: "Ride-hailing and mobility",
    keywords: ["ride", "rides", "driver", "drivers", "trip", "pickup", "fleet", "vehicle", "vehicles", "taxi", "scooter", "dispatch", "rental car"],
    brands: [
      b("uber", "Uber", "https://www.uber.com", "#000000", "plain", "soft", "pure black and white, no accent colour, map-led"),
      b("lyft", "Lyft", "https://www.lyft.com", "#FF00BF", "plain", "round", "hot pink on white or deep purple, friendly"),
      b("bolt", "Bolt", "https://bolt.eu", "#34D186", "plain", "round", "fresh green on white"),
      b("grab", "Grab", "https://www.grab.com", "#00B14F", "brand", "round", "green bar, white cards, super-app grid"),
      b("careem", "Careem", "https://www.careem.com", "#2EAD4B", "plain", "round", "green with warm greys"),
    ],
    pattern: "The map is the page; the brand colour appears on the one primary action and on the selected vehicle or route. Surfaces are white or black with big touch targets and a bottom sheet for details. Trip status is a short timeline (arriving, on trip, done).",
    usual: { mode: "light", chrome: "plain", neutral: "pure", font: "sans", radius: "round", density: "comfortable", surface: "flat" },
  },
  {
    id: "media", label: "Streaming and media",
    keywords: ["streaming", "video", "videos", "playlist", "podcast", "music", "episode", "episodes", "watch", "player", "subscribers", "channel", "creator", "article", "newsroom"],
    brands: [
      b("netflix", "Netflix", "https://www.netflix.com", "#E50914", "plain", "soft", "black page, one red, poster rows", { mode: "dark" }),
      b("spotify", "Spotify", "https://www.spotify.com", "#1DB954", "plain", "round", "near-black with green for play and selection", { mode: "dark" }),
      b("youtube", "YouTube", "https://www.youtube.com", "#FF0000", "plain", "round", "white or black page, red only for the brand and subscribe", {}),
      b("disney", "Disney+", "https://www.disneyplus.com", "#113CCF", "plain", "round", "deep navy gradient field, brand tiles", { mode: "dark" }),
      b("nyt", "The New York Times", "https://www.nytimes.com", "#000000", "plain", "sharp", "black on white, serif headlines, dense columns"),
    ],
    pattern: "Dark surfaces for video and music with one vivid colour for play, selection or live; thumbnails carry the colour. News and editorial stay white with serif headlines and black text. A player has a persistent bar and a clear progress line.",
    usual: { mode: "dark", chrome: "plain", neutral: "pure", font: "sans", radius: "soft", density: "comfortable", surface: "flat" },
  },
  {
    id: "devtools", label: "Developer and SaaS tools",
    keywords: ["developer", "developers", "api", "deployment", "deployments", "pipeline", "repository", "dashboard", "workspace", "ticket", "tickets", "issue", "issues", "analytics", "admin", "console", "logs", "monitoring"],
    brands: [
      b("github", "GitHub", "https://github.com", "#238636", "plain", "soft", "dark or white, green merge button, system font, tight tables", {}),
      b("linear", "Linear", "https://linear.app", "#5E6AD2", "plain", "soft", "near-black or white, one muted indigo, very dense lists", { mode: "dark" }),
      b("vercel", "Vercel", "https://vercel.com", "#000000", "plain", "sharp", "pure black and white, hairlines, no colour"),
      b("notion", "Notion", "https://www.notion.so", "#000000", "plain", "soft", "warm white, black text, serif option, almost no colour"),
      b("atlassian", "Atlassian", "https://www.atlassian.com", "#0052CC", "plain", "soft", "blue on white with status lozenges"),
      b("datadog", "Datadog", "https://www.datadoghq.com", "#632CA6", "plain", "soft", "purple brand, dense charts on white or dark"),
    ],
    pattern: "Neutrals first (white or a deliberate dark), one cool accent for the primary action, hairline borders, small type and compact tables. Colour appears for status (running, failed) and in charts. These tools are dense on purpose; avoid hero banners and large cards.",
    usual: { mode: "light", chrome: "plain", neutral: "cool", font: "sans", radius: "soft", density: "compact", surface: "flat" },
  },
  {
    id: "logistics", label: "Logistics and shipping",
    keywords: ["shipment", "shipments", "shipping", "freight", "cargo", "parcel", "tracking", "warehouse", "carrier", "consignment", "waybill", "dispatch", "pallet", "customs"],
    brands: [
      b("fedex", "FedEx", "https://www.fedex.com", "#4D148C", "plain", "soft", "purple and orange on white, tracking timeline", { accent: "#FF6600" }),
      b("ups", "UPS", "https://www.ups.com", "#351C15", "plain", "soft", "dark brown with gold on white", { accent: "#FFB500" }),
      b("dhl", "DHL", "https://www.dhl.com", "#D40511", "brand", "sharp", "yellow bar with red text and buttons", { accent: "#FFCC00" }),
      b("maersk", "Maersk", "https://www.maersk.com", "#42B0D5", "plain", "soft", "light blue on white, calm and corporate"),
      b("usps", "USPS", "https://www.usps.com", "#333366", "plain", "sharp", "blue-grey with red accents, plain utility", { accent: "#DA291C" }),
    ],
    pattern: "A strong company colour on a grey or white utility page; tracking is a vertical timeline with the current scan highlighted and a status banner. Tables are dense with status chips (in transit, delayed, delivered). Carriers differ in which of two colours leads (DHL yellow bar, FedEx purple text).",
    usual: { mode: "light", chrome: "brand", neutral: "cool", font: "sans", radius: "sharp", density: "compact", surface: "flat" },
  },
  {
    id: "telecom", label: "Telecom and utilities",
    keywords: ["telecom", "mobile plan", "data plan", "sim", "broadband", "bill", "billing", "usage", "tariff", "subscriber", "utility", "meter", "electricity"],
    brands: [
      b("verizon", "Verizon", "https://www.verizon.com", "#EE0000", "plain", "sharp", "black and white with a red mark, flat and bold"),
      b("att", "AT&T", "https://www.att.com", "#009FDB", "plain", "soft", "bright blue on white, dark text"),
      b("tmobile", "T-Mobile", "https://www.t-mobile.com", "#E20074", "plain", "soft", "magenta on white or black, bold type"),
      b("vodafone", "Vodafone", "https://www.vodafone.com", "#E60000", "brand", "round", "red bar and speech-mark brand, white cards"),
      b("o2", "O2", "https://www.o2.co.uk", "#0019A5", "brand", "round", "deep blue bar with bubble motifs"),
    ],
    pattern: "A bold brand colour (red, magenta or blue) as the app bar or primary button over white; usage and bill figures are large with a simple bar or ring for remaining data. Plans are comparison cards with one highlighted.",
    usual: { mode: "light", chrome: "brand", neutral: "cool", font: "sans", radius: "soft", density: "comfortable", surface: "flat" },
  },
  {
    id: "education", label: "Education and learning",
    keywords: ["student", "students", "course", "courses", "lesson", "lessons", "learner", "learners", "teacher", "classroom", "quiz", "curriculum", "enrol", "enroll", "grades", "school"],
    brands: [
      b("duolingo", "Duolingo", "https://www.duolingo.com", "#58CC02", "plain", "round", "bright green, chunky rounded buttons, playful"),
      b("coursera", "Coursera", "https://www.coursera.org", "#0056D2", "plain", "soft", "blue on white, course cards"),
      b("khan", "Khan Academy", "https://www.khanacademy.org", "#14BF96", "plain", "soft", "teal green on navy and white, plain"),
      b("udemy", "Udemy", "https://www.udemy.com", "#A435F0", "plain", "sharp", "purple on white with a black bar, dense catalogue"),
      b("canvas", "Canvas", "https://www.instructure.com", "#E72429", "plain", "soft", "red on dark nav with plain white content"),
    ],
    pattern: "Friendly saturated colour with round shapes for learners (a streak, a progress ring, a big next-lesson button); catalogue sites are white with course cards and star ratings. Teacher tools are plainer and denser with grade tables.",
    usual: { mode: "light", chrome: "plain", neutral: "warm", font: "humanist", radius: "round", density: "comfortable", surface: "soft" },
  },
  {
    id: "government", label: "Government and public services",
    keywords: ["citizen", "citizens", "permit", "permits", "licence", "license", "tax", "benefit", "benefits", "municipal", "council", "passport", "public service", "form application", "complaint"],
    brands: [
      b("govuk", "GOV.UK", "https://www.gov.uk", "#1D70B8", "plain", "sharp", "white page, black text, one blue, thick focus outline, a black bar", { accent: "#0B0C0C" }),
      b("usagov", "USA.gov", "https://www.usa.gov", "#005EA2", "plain", "sharp", "plain white with one blue, banner strip, serif headings"),
      b("canada", "Canada.ca", "https://www.canada.ca", "#26374A", "plain", "sharp", "dark slate with a red flag and underlined links", { accent: "#AF3C43" }),
      b("service-au", "Services Australia", "https://www.servicesaustralia.gov.au", "#00698F", "plain", "sharp", "teal-blue on white, plain forms"),
    ],
    pattern: "Plain white, black text, one blue, visible underlined links, square corners and one question per page in forms. No decoration; status is written in words, with colour only to support it. Never look like a startup.",
    usual: { mode: "light", chrome: "plain", neutral: "pure", font: "sans", radius: "sharp", density: "comfortable", surface: "flat" },
  },
  {
    id: "insurance", label: "Insurance",
    keywords: ["insurance", "insurer", "policy", "policies", "claim", "claims", "premium", "underwriting", "coverage", "policyholder", "adjuster"],
    brands: [
      b("allianz", "Allianz", "https://www.allianz.com", "#003781", "plain", "soft", "royal blue on white, formal and calm"),
      b("lemonade", "Lemonade", "https://www.lemonade.com", "#FF0083", "plain", "round", "hot pink on white, playful and conversational"),
      b("statefarm", "State Farm", "https://www.statefarm.com", "#E31837", "plain", "soft", "red on white, plain forms and agent cards"),
      b("geico", "GEICO", "https://www.geico.com", "#0B3E8E", "plain", "soft", "blue with a green accent, quote form up front", { accent: "#8DC63F" }),
      b("progressive", "Progressive", "https://www.progressive.com", "#0A58CA", "plain", "soft", "blue on white, quote form as hero"),
    ],
    pattern: "Reassuring blue (or one confident pink or red for a newer brand) on white, with the quote or claim form as the first thing. Claims show a status timeline and documents list; amounts are plain and large.",
    usual: { mode: "light", chrome: "plain", neutral: "cool", font: "sans", radius: "soft", density: "comfortable", surface: "flat" },
  },
];

export const INDUSTRIES: RefIndustry[] = RAW.map((r) => RefIndustry.parse(r));
