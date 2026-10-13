// What the factory designs and builds today: web apps (temporary, until it builds phone apps). An estimate still prices a phone app when the client asks for one
// (src/stages/estimate.ts); a design run or a new product draws and builds the same requirements as one responsive web app.

/** Told to every model call of a design run or a new product (src/stages/think.ts). */
export const WEB_ONLY = `PLATFORM. This product is designed and built as a web app, and nothing else. Where the requirements ask for a mobile app, a phone app, an iOS or Android app, treat them as the same features in one responsive web app that works well on a phone's browser: never stop, park, ask or leave a requirement out because it names a mobile app, and never plan a native app, an app store step or a phone-only frame. Every page is responsive: it is laid out for a phone, a tablet and a desktop width, with touch-sized controls on the narrow one. What only a native app can do (push notifications, background location, a home-screen icon) is given its closest web form (an in-app notice or email, the browser's location prompt, an installable web app) and said so.`;

/**
 * A design run or a new product: web only, unless the project switches it off (`webOnly: false`). An estimate run, and work in an
 * existing repo, are left as they are. TEMPORARY: this stands until the factory builds phone apps; then the switch's default
 * turns to false and a phone app is drawn as one again.
 */
export const webOnly = (mode: string | undefined, project?: { webOnly?: boolean | undefined }): boolean => project?.webOnly !== false && (mode === "greenfield" || mode === "design");

/** How the API run of a full-stack product's request says which side it is (src/fullstack/product.ts, apiRequest). */
export const API_SIDE_OPENING = "This run builds the API side of the product above";

/**
 * Told to a model call of a product's API run whose request does not say which side it is: a large request is read module by
 * module, and the sentence that says so ends the request, so only the last module holds it.
 */
export const apiSideNote = (contractFile: string): string =>
  `PRODUCT SIDE. This run builds the API side of the product these requirements describe, in an existing .NET API project: every operation of the locked API contract in ${contractFile}, exactly as it is written there, and the data behind them. The web app is built in its own repo: no screen is built here, and no criterion is written for one.`;

/** The API side of a full-stack product: a .NET project held to a contract it builds. */
export const apiSide = (project?: { stack?: string | undefined; contract?: { file: string; built?: string | undefined } | undefined }): boolean => project?.stack === "dotnet" && !!project.contract?.built;

interface AppLike { device?: string | undefined; shell?: string | undefined }
interface LookLike { shell?: string | undefined; reading?: { device?: string | undefined } | undefined }

/**
 * A drawn design as a web app: an app the model still called a phone app becomes a web one, and a bottom tab bar (the frame only
 * a phone app has) becomes a top bar, which folds to a menu on a narrow screen. Changed here rather than sent back: a wrong word
 * for the device is not worth a second model call.
 */
export function asWeb<T extends { apps?: AppLike[] | undefined; theme?: LookLike | undefined }>(out: T): T {
  const shell = (s: string | undefined) => (s === "tabs" ? "topbar" : s);
  const apps = out.apps?.map((a) => ({ ...a, device: "web", shell: shell(a.shell) }));
  const theme = out.theme && { ...out.theme, shell: shell(out.theme.shell), ...(out.theme.reading ? { reading: { ...out.theme.reading, device: out.theme.reading.device === "phone" ? "both" : out.theme.reading.device } } : {}) };
  return { ...out, ...(apps ? { apps } : {}), ...(theme ? { theme } : {}) } as T;
}
