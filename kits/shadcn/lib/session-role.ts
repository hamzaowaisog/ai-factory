// The signed-in person's kind of user, for the frame's navigation: a product whose pages are for different kinds of user
// (employee, admin) lists each page only for its own kind. The sign-in sets it (one of the kinds the frame's navigation
// names) and the sign-out clears it.
const KEY = "factory_session_role";

export function getSessionRole(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setSessionRole(role: string | null): void {
  try {
    if (role) window.localStorage.setItem(KEY, role);
    else window.localStorage.removeItem(KEY);
  } catch {
    // storage blocked: the navigation then follows the page being shown
  }
}
