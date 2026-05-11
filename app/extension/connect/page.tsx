// where: app/extension/connect/page.tsx
// what:  Web-to-extension connection page for the Chrome side panel extension.
// why:   The user authenticates with the existing Google Web flow, then explicitly
//        grants the unpacked extension a bearer copy of the encrypted Auth.js session.

import { auth } from "@/auth";
import { SignInForm } from "@/components/sign-in-button";
import { ExtensionConnectClient } from "./connect-client";

type ConnectPageProps = {
  searchParams: Promise<{ extensionId?: string | string[] }>;
};

export default async function ExtensionConnectPage({
  searchParams,
}: ConnectPageProps) {
  const params = await searchParams;
  const extensionId = Array.isArray(params.extensionId)
    ? params.extensionId[0]
    : params.extensionId;
  const session = await auth();
  const email = session?.user?.email ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-5 px-4 py-10">
        <header className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            Chrome extension
          </p>
          <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
            SS_schedule 拡張機能に接続
          </h1>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
            Google ログイン済みのセッションを、サイドパネル拡張から API
            呼び出しできるように接続します。
          </p>
        </header>

        {!email ? (
          <div className="rounded-2xl border border-black/[.08] bg-white p-4 dark:border-white/[.08] dark:bg-zinc-950">
            <p className="mb-4 text-sm text-zinc-700 dark:text-zinc-200">
              先に Google でサインインしてください。
            </p>
            <SignInForm />
          </div>
        ) : (
          <ExtensionConnectClient email={email} extensionId={extensionId ?? ""} />
        )}
      </main>
    </div>
  );
}
