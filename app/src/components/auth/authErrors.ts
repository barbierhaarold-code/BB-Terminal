import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";

/** Map a Supabase auth error to a message safe and useful to show on screen. */
export function describeAuthError(err: unknown): string {
  if (err instanceof AuthRetryableFetchError || (err instanceof TypeError && /fetch|network/i.test(err.message))) {
    return "Network error — cannot reach the authentication server. Check your connection and try again.";
  }
  if (err instanceof AuthApiError || (err && typeof err === "object" && "code" in err)) {
    const e = err as { code?: string; status?: number; message?: string };
    switch (e.code) {
      case "invalid_credentials": return "Invalid email or password.";
      case "email_not_confirmed": return "This email address is not confirmed yet. Use the link in your invitation email.";
      case "over_request_rate_limit":
      case "over_email_send_rate_limit": return "Too many attempts. Wait a minute and try again.";
      case "weak_password": return "Password is too weak. Use at least 8 characters, mixing letters and digits.";
      case "same_password": return "The new password must differ from the previous one.";
      case "user_banned": return "This account has been disabled.";
      case "session_not_found":
      case "refresh_token_not_found":
      case "refresh_token_already_used": return "Your session has expired. Please sign in again.";
    }
    if (e.status === 429) return "Too many attempts. Wait a minute and try again.";
    if (e.status && e.status >= 500) return "The authentication server had a problem. Try again shortly.";
    if (e.message) return e.message;
  }
  return "Something went wrong. Please try again.";
}
