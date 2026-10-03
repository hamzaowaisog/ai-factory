// A design that uses every block, form field and layer the schema has, for the kit's tests and its build check
// (`factory design scaffold --sample`). Two web pages per kind of product, a phone app (built with the repo's own), Urdu as the
// second language.
import type { z } from "zod";
import { DesignBody } from "../../contracts/artifacts.js";

const FIELD_KINDS = ["text", "select", "date", "textarea", "toggle", "radio", "checkbox", "number", "currency", "otp", "phone", "search", "slider", "card", "password", "email", "time", "daterange", "multiselect", "combobox", "consent"] as const;
const opts = ["Alpha", "Beta", "Gamma"];
const fields = (from: number, to: number) => FIELD_KINDS.slice(from, to).map((kind) => ({ label: `Field ${kind}`, kind, options: opts, ...(kind === "slider" ? { value: "20" } : {}) }));

export function sampleDesign(): z.infer<typeof DesignBody> {
  return DesignBody.parse({
    flow: "Sign in, see the dashboard, open an invoice, pay it.",
    themeSource: "new",
    theme: { mood: "calm finance", mode: "auto", brand: "#1a56db", accent: "#0e9f6e", shell: "auto" },
    locale: { languages: ["en", "ur"], region: "PK", currency: "PKR", strings: [{ from: "Money", to: "رقم" }] },
    apps: [
      { id: "portal", name: "Billing portal", device: "web", switcher: { kind: "workspace", current: "Acme", meta: "Pro plan", others: ["Globex"] } },
      { id: "mobile", name: "Billing app", device: "phone" },
    ],
    mapping: { unmappedReqs: [], orphanScreens: [] },
    screens: [
      {
        id: "S-1", route: "/", file: "app/page.tsx", reqs: ["R-1"], app: "portal", group: "Money", states: ["default", "loading", "empty", "error"],
        mock: {
          title: "Dashboard", subtitle: "This month at a glance", crumbs: ["Home"],
          blocks: [
            { type: "stats", items: [{ label: "Due", value: "PKR 120,000", delta: "+4%" }, { label: "Paid", value: "PKR 80,000" }] },
            { type: "chart", kind: "bar", title: "Revenue", points: [{ label: "Jan", value: 10 }, { label: "Feb", value: 14 }], ranges: ["7D", "30D"] },
            { type: "toolbar", search: "Search invoices", selects: [{ label: "Status", options: ["All", "Paid"], value: "All" }], buttons: [{ label: "Export", variant: "secondary", menu: ["CSV", "PDF"] }] },
            { type: "table", columns: ["Invoice", "Client", "Status"], rows: [["INV-1", "Acme", "Paid"], ["INV-2", "Globex", "Overdue"]], statusColumn: 2, sortBy: 0, selectable: true, bulk: ["Mark paid"], pages: 4 },
            { type: "alert", tone: "warn", title: "Two invoices overdue", text: "Send a reminder today.", action: "Remind" },
            { type: "actions", buttons: ["New invoice", { label: "Delete all", variant: "danger" }] },
          ],
          links: [{ from: "INV-1", to: "S-2" }],
          overlays: [
            { kind: "modal", trigger: "New invoice", title: "New invoice", blocks: [{ type: "form", fields: [{ label: "Client", kind: "select", options: opts }], submit: "Create" }], actions: ["Create", "Cancel"] },
            { kind: "confirm", trigger: "Delete all", title: "Delete every invoice?", text: "This cannot be undone.", actions: [{ label: "Delete", variant: "danger" }, "Keep them"] },
            { kind: "menu", trigger: "More", title: "Row actions", items: ["Open", "Duplicate", "Archive"] },
          ],
          toasts: [{ after: "Mark paid", text: "Marked as paid", tone: "ok", undo: true }],
          copy: { emptyTitle: "No invoices yet", emptyHint: "Create one to get paid.", error: "We could not load your invoices." },
          tr: [{ from: "Dashboard", to: "ڈیش بورڈ" }, { from: "Revenue", to: "آمدنی" }],
        },
        mockFull: { title: "Dashboard", blocks: [{ type: "stats", items: [{ label: "Due", value: "PKR 120,000" }, { label: "Paid", value: "PKR 80,000" }, { label: "Late", value: "3" }] }] },
      },
      {
        id: "S-2", route: "/invoices/:id", file: "app/invoices/[id]/page.tsx", reqs: ["R-2"], app: "portal", states: ["default", "success", "validation"],
        mock: {
          title: "Invoice", badge: "Overdue", crumbs: ["Invoices"], tabs: ["Overview", "Activity"],
          blocks: [
            { type: "detail", title: "INV-2", lead: { label: "Amount due", value: "PKR 40,000" }, rows: [{ label: "Status", value: "Overdue", badge: true }], people: ["Ana Lima", "Bo Chen"] },
            { type: "receipt", title: "Invoice INV-2", status: "Overdue", lines: [{ item: "Design", qty: "1", amount: "PKR 40,000" }], totals: [{ label: "Total", value: "PKR 40,000" }] },
            { type: "timeline", items: [{ time: "Mon", title: "Sent", status: "done" }, { time: "Today", title: "Reminder", status: "now" }] },
            { type: "form", fields: FIELD_KINDS.slice(0, 6).map((kind) => ({ label: `Field ${kind}`, kind, options: opts, required: kind === "text", error: kind === "text" ? "Enter a value" : undefined })), submit: "Pay now" },
            { type: "steps", items: ["Details", "Pay", "Done"], current: 1 },
            { type: "progress", title: "Paid so far", items: [{ label: "Paid", value: 40, meta: "PKR 16,000" }] },
          ],
          overlays: [
            { kind: "drawer", trigger: "Overview", title: "History", blocks: [{ type: "list", items: [{ title: "Sent", meta: "Mon" }] }] },
            { kind: "sheet", trigger: "Pay now", title: "Pay", actions: ["Confirm"] },
            { kind: "popover", trigger: "Activity", title: "Share link", text: "Anyone with the link can view." },
          ],
          toasts: [{ after: "Confirm", text: "Payment sent", tone: "ok" }],
          copy: { success: "Invoice paid.", validation: "Fix the highlighted fields." },
        },
      },
      {
        id: "S-3", route: "/settings", file: "app/settings/page.tsx", reqs: ["R-3"], app: "portal", group: "Account",
        mock: {
          title: "Settings",
          blocks: [
            { type: "form", fields: fields(6, 12), submit: "Save" },
            { type: "form", fields: fields(12, 18), submit: "Save" },
            { type: "accordion", items: [{ title: "Plan", body: "Pro" }, { title: "Billing", body: "Card" }] },
            { type: "upload", label: "Logo", files: [{ name: "logo.png", size: "20 KB", status: "uploading", progress: 40 }] },
            { type: "plans", periods: ["Monthly", "Yearly"], items: [{ name: "Free", price: "PKR 0", features: ["1 user"], cta: "Choose" }, { name: "Pro", price: "PKR 2,000", alt: "PKR 20,000", features: ["10 users"], cta: "Upgrade", featured: true }] },
            { type: "compare", items: [{ name: "Free" }, { name: "Pro", featured: true }], rows: [{ label: "Users", values: ["1", "10"] }, { label: "Support", values: ["No", "Yes"] }], cta: "Pick" },
          ],
        },
      },
      {
        id: "S-4", route: "/explore", file: "app/explore/page.tsx", reqs: ["R-4"], app: "portal", group: "Account",
        mock: {
          title: "Explore",
          blocks: [
            { type: "filters", search: "Search", chips: ["Open", "Near me"], segments: ["List", "Map"] },
            { type: "results", count: "12 results", sort: ["Best", "Newest"], facets: [{ title: "Price", kind: "range", options: ["0", "100"] }, { title: "Type", options: ["A", "B"], picked: ["A"] }], items: [{ title: "Studio", meta: "Lahore", price: "PKR 9,000" }] },
            { type: "cards", visual: true, items: [{ title: "Team", meta: "4 people", people: ["Ana", "Bo", "Cy", "Di", "Ed", "Fa"] }] },
            { type: "carousel", style: "promo", items: [{ title: "Pay faster", meta: "New", cta: "Try" }, { title: "Reports", meta: "Soon" }] },
            { type: "map", area: "Lahore", pins: [{ label: "Office", tone: "ok" }, { label: "Bank" }], route: true },
            { type: "gallery", layout: "grid", items: [{ caption: "One" }, { caption: "Two" }] },
          ],
        },
      },
      {
        id: "S-5", route: "/inbox", file: "app/inbox/page.tsx", reqs: ["R-5"], app: "portal", group: "Money",
        mock: {
          title: "Inbox",
          blocks: [
            { type: "chat", with: "Acme support", messages: [{ from: "them", text: "Hi" }, { from: "me", text: "Hello" }], quick: ["Thanks"] },
            { type: "notifications", items: [{ title: "Invoice paid", time: "1h", unread: true, tone: "ok", group: "Today" }] },
            { type: "kanban", columns: [{ title: "To do", cards: [{ title: "Chase INV-2", badge: "High" }] }, { title: "Done", cards: [] }] },
            { type: "calendar", month: "March 2027", startsOn: 0, days: 31, picked: 12, marks: [{ day: 12, label: "Due", tone: "warn" }], off: [6, 7], times: ["09:00", "10:00"], taken: ["09:00"] },
            { type: "reviews", score: 4.5, count: "120 ratings", bars: [70, 20, 5, 3, 2], items: [{ name: "Ana", rating: 5, text: "Great" }] },
          ],
        },
      },
      {
        id: "S-7", route: "/clients", file: "app/clients/page.tsx", reqs: ["R-7"], app: "portal", group: "Money",
        mock: {
          title: "Clients",
          blocks: [
            { type: "list", items: [{ title: "Acme", meta: "2 invoices", badge: "Active" }] },
            { type: "form", fields: fields(18, 21), submit: "Add client" },
            { type: "text", body: "Changes apply to everyone in the workspace." },
          ],
        },
      },
      { id: "S-6", route: "/m/home", file: "mobile/home.tsx", reqs: ["R-6"], app: "mobile", mock: { title: "Home", blocks: [{ type: "text", body: "Phone" }] } },
    ],
  });
}
