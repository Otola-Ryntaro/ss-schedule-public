// where: components/sign-in-button.tsx
// what:  Sign-in / sign-out controls extracted from the SS-003 placeholder UI.
// why:   Auth.js v5 wants Server Action forms for credential-bearing flows. Keeping
//        them in a dedicated module lets the home page focus on layout while the
//        auth controls stay close to the auth boundary.

import { signIn, signOut } from "@/auth";

export function SignInForm() {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("google");
      }}
    >
      <button
        type="submit"
        className="inline-flex min-h-11 touch-manipulation items-center justify-center rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
      >
        Google でサインイン
      </button>
    </form>
  );
}

// Re-authentication trigger. Identical OAuth call as SignInForm, but worded for the
// "your Google connection expired" case so the user knows this fixes a broken state
// rather than starting a fresh login. access_type:offline + prompt:consent (see auth.ts)
// guarantee a brand-new refresh token is issued, which is what recovers the connection.
export function ReconnectForm() {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("google");
      }}
    >
      <button
        type="submit"
        className="inline-flex min-h-11 touch-manipulation items-center justify-center rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
      >
        Google に再接続
      </button>
    </form>
  );
}

export function SignOutForm() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <button
        type="submit"
        className="rounded-full border border-black/[.08] dark:border-white/[.145] px-3 py-1.5 text-xs transition-colors hover:bg-black/[.04] dark:hover:bg-[#1a1a1a]"
      >
        サインアウト
      </button>
    </form>
  );
}
