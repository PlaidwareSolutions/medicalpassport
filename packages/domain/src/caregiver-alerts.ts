/**
 * Bounds for the Home "Missed-dose alert history": both the open (missed)
 * and recently-resolved branches show only the trailing window, silently
 * capped at the most recent few. Shared by the API list query, the
 * hasOpenAlerts profile-switcher badge, and the client's defensive slice
 * so the three can't drift apart — a badge that outlives the list it
 * points at would be worse than either bound alone.
 */
export const CAREGIVER_ALERT_WINDOW_DAYS = 7;
export const CAREGIVER_ALERT_MAX_ITEMS = 5;
