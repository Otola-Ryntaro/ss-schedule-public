// where: app/page.tsx
// what:  Home page server component. Branches on Auth.js session: signed-out users
//        see the Google sign-in form, signed-in users see the screenshot composer.
// why:   Keeping the auth check on the server prevents an unauthenticated flash of
//        the composer UI and lets us hand the email down to the client component
//        without exposing tokens (those stay in the JWT only — see auth.ts).

import { Camera, Sparkles, CalendarPlus, ShieldCheck } from "lucide-react";
import { auth } from "@/auth";
import { ScreenshotComposer } from "@/components/screenshot-composer";
import { SignInForm, SignOutForm } from "@/components/sign-in-button";

export default async function Home() {
  const session = await auth();
  const email = session?.user?.email ?? null;

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        {email ? (
          <ScreenshotComposer email={email} signOutSlot={<SignOutForm />} />
        ) : (
          <LandingPane />
        )}
      </main>
    </div>
  );
}

// M1: pre-signin landing. Three-step flow + minimal-scope reassurance to lift trust
// before the OAuth dialog. Kept as a server component (no client state needed).
function LandingPane() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          SS_schedule
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          スクショ / テキストから Google カレンダーへ 1 タップ登録。
        </p>
      </div>

      <ol className="grid w-full max-w-2xl gap-3 text-left sm:grid-cols-3">
        <Step
          n={1}
          title="撮る・貼る"
          body="スクショ / 画像 / 予定が書かれたテキストを取り込み。"
          icon={<Camera className="size-5" />}
        />
        <Step
          n={2}
          title="AI が抽出"
          body="日時・タイトル・場所・URL を Gemini が自動で読み取り。"
          icon={<Sparkles className="size-5" />}
        />
        <Step
          n={3}
          title="登録"
          body="内容を確認・編集してカレンダーへ 1 タップ送信。"
          icon={<CalendarPlus className="size-5" />}
        />
      </ol>

      <SignInForm />

      <p className="inline-flex max-w-md items-center justify-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <ShieldCheck className="size-3.5" />
        要求するのは予定の書込権限のみ（calendar.events）。メールや連絡先には触りません。
      </p>
    </div>
  );
}

function Step({
  n,
  title,
  body,
  icon,
}: {
  n: number;
  title: string;
  body: string;
  icon: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-black/[.08] bg-white p-4 dark:border-white/[.08] dark:bg-zinc-950">
      <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-200">
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
          {n}
        </span>
        <span className="text-zinc-500 dark:text-zinc-400">{icon}</span>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-400">{body}</p>
    </li>
  );
}
