// The design's blocks as props (src/contracts/artifacts.ts, blockSchema): what the approved design said a block shows.
// A container passes real data in the same shape; the fixtures pass the approved sample data.

export type Tone = "ok" | "warn" | "bad" | "info";
export interface ButtonSpec { label: string; variant?: "primary" | "secondary" | "ghost" | "danger" | "link"; icon?: string; iconOnly?: boolean; state?: "disabled" | "loading"; hint?: string; menu?: string[] }
export type ButtonLike = string | ButtonSpec;
export type FieldKind = "text" | "select" | "date" | "textarea" | "toggle" | "radio" | "checkbox" | "number" | "currency" | "otp" | "phone" | "search" | "slider" | "card" | "password" | "email" | "time" | "daterange" | "multiselect" | "combobox" | "consent";
export interface Field { label: string; kind?: FieldKind; placeholder?: string; value?: string; options?: string[]; required?: boolean; help?: string; disabled?: boolean; readOnly?: boolean; error?: string; hint?: string }
export interface Item { title: string; meta: string; badge?: string; people?: string[] }

/** What every block takes besides its data: its marker for the fidelity checks, and the actions it reports. */
export interface BlockEvents {
  /** the block's type, written as data-b as the approved demo marks it, so the built page reads back like the demo for the structure check */
  mark?: string;
  /** a button, menu entry, row, card or link was pressed: its label, and the element (overlays open beside it) */
  onAction?: (label: string, at?: HTMLElement) => void;
  /** the page's validation state: every field shows its error */
  invalid?: boolean;
  className?: string;
}

export interface StatsData { items: { label: string; value: string; delta?: string }[] }
export interface FiltersData { search?: string; chips?: string[]; segments?: string[] }
export interface TableData { columns: string[]; rows: string[][]; statusColumn?: number; sortBy?: number; sortDir?: "asc" | "desc"; selectable?: boolean; bulk?: ButtonLike[]; pages?: number; page?: number }
export interface FormData { fields: Field[]; submit?: string }
export interface ChartData { kind?: "bar" | "line" | "stacked" | "donut" | "progress" | "gauge"; title: string; points: { label: string; value: number; parts?: number[] }[]; series?: string[]; max?: number; unit?: string; ranges?: string[] }
export interface CardsData { visual?: boolean; items: Item[] }
export interface CarouselData { style?: "promo" | "media"; title?: string; items: { title: string; meta: string; badge?: string; cta?: string }[] }
export interface StepsData { items: string[]; current?: number }
export interface TimelineData { items: { time: string; title: string; meta?: string; status?: "done" | "now" | "next" }[] }
export interface DetailData { style?: "card" | "pass"; title?: string; lead?: { label: string; value: string }; rows: { label: string; value: string; badge?: boolean }[]; people?: string[] }
export interface AccordionData { title?: string; items: { title: string; body: string }[] }
export interface ListData { items: Item[] }
export interface CalendarData { month: string; startsOn: number; days: number; picked?: number; marks?: { day: number; label?: string; tone?: Tone }[]; off?: number[]; times?: string[]; taken?: string[]; time?: string }
export interface MapData { area?: string; pins: { label: string; meta?: string; tone?: Tone; lat?: number; lng?: number }[]; route?: boolean }
export interface GalleryData { layout?: "hero" | "grid"; items: { caption: string; src?: string }[] }
export interface UploadData { label: string; hint?: string; files?: { name: string; size: string; status?: "done" | "uploading" | "failed"; progress?: number }[] }
export interface ChatData { with: string; meta?: string; messages: { from: "me" | "them"; text: string; time?: string }[]; quick?: string[]; placeholder?: string }
export interface KanbanData { columns: { title: string; cards: { title: string; meta?: string; badge?: string }[] }[] }
export interface PlansData { periods?: string[]; note?: string; items: { name: string; price: string; alt?: string; per?: string; blurb?: string; features: string[]; cta: string; featured?: boolean; badge?: string }[] }
export interface ReviewsData { score: number; count: string; bars?: number[]; items: { name: string; rating: number; text: string; time?: string; tag?: string }[] }
export interface NotificationsData { items: { title: string; meta?: string; time: string; unread?: boolean; tone?: Tone; group?: string }[] }
export interface ResultsData { query?: string; count: string; sort?: string[]; visual?: boolean; facets: { title: string; kind?: "check" | "range"; options: string[]; picked?: string[] }[]; items: { title: string; meta: string; badge?: string; price?: string }[] }
export interface CompareData { items: { name: string; meta?: string; featured?: boolean }[]; rows: { label: string; values: string[] }[]; cta?: string }
export interface ReceiptData { title: string; status?: string; from?: string; to?: string; facts?: { label: string; value: string }[]; lines: { item: string; qty?: string; amount: string }[]; totals: { label: string; value: string }[]; note?: string }
export interface ActionsData { buttons: ButtonLike[] }
export interface AlertData { tone?: Tone; title?: string; text: string; action?: string }
export interface ToolbarData { search?: string; selects?: { label: string; options: string[]; value?: string }[]; buttons?: ButtonLike[] }
export interface ProgressData { title?: string; items: { label: string; value: number; meta?: string }[] }
export interface TextData { body: string }

/** One block of a screen, as the design wrote it. */
export type Block =
  | ({ type: "stats" } & StatsData) | ({ type: "filters" } & FiltersData) | ({ type: "table" } & TableData) | ({ type: "form" } & FormData)
  | ({ type: "chart" } & ChartData) | ({ type: "cards" } & CardsData) | ({ type: "carousel" } & CarouselData) | ({ type: "steps" } & StepsData)
  | ({ type: "timeline" } & TimelineData) | ({ type: "detail" } & DetailData) | ({ type: "accordion" } & AccordionData) | ({ type: "list" } & ListData)
  | ({ type: "calendar" } & CalendarData) | ({ type: "map" } & MapData) | ({ type: "gallery" } & GalleryData) | ({ type: "upload" } & UploadData)
  | ({ type: "chat" } & ChatData) | ({ type: "kanban" } & KanbanData) | ({ type: "plans" } & PlansData) | ({ type: "reviews" } & ReviewsData)
  | ({ type: "notifications" } & NotificationsData) | ({ type: "results" } & ResultsData) | ({ type: "compare" } & CompareData) | ({ type: "receipt" } & ReceiptData)
  | ({ type: "actions" } & ActionsData) | ({ type: "alert" } & AlertData) | ({ type: "toolbar" } & ToolbarData) | ({ type: "progress" } & ProgressData)
  | ({ type: "text" } & TextData);

export const label = (b: ButtonLike): string => (typeof b === "string" ? b : b.label);
