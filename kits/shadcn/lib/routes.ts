// Turn the design's routes ("/accounts/:id") into links with the sample record's id.

/** A route with every parameter filled with a sample value, so a link from the design opens a page. */
export function hrefFor(route: string, sample = "1"): string {
  return route.replace(/:[A-Za-z_]\w*/g, sample).replace(/\[[^\]]+\]/g, sample) || "/";
}

/** True when the path is this route (parameters match any one segment). */
export function matches(route: string, path: string): boolean {
  const re = new RegExp(`^${route.replace(/:[A-Za-z_]\w*/g, "[^/]+").replace(/\/$/, "")}/?$`);
  return re.test(path);
}
