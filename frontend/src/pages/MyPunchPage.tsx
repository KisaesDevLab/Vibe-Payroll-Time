import { Button } from '../components/Button';
import { TopBar } from '../components/TopBar';
import { useSession } from '../hooks/useSession';

/**
 * Personal-device punch interface for employees who have a user account.
 *
 * Phase 4 scaffold: shows the current status and a big clock-in/out
 * button. The actual punch call goes live in Phase 5 when the punch
 * engine + /api/v1/punch/* endpoints land.
 */
export function MyPunchPage() {
  const session = useSession();
  if (!session) return null;

  return (
    <>
      <TopBar />
      <main className="mx-auto flex max-w-md flex-col gap-8 px-6 py-10">
        <header>
          <p className="text-xs uppercase tracking-widest text-slate-500">My time</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">
            {session.user.email}
          </h1>
        </header>

        <section className="flex flex-col items-center gap-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-center">
            <p className="text-xs uppercase tracking-widest text-slate-500">Status</p>
            <p className="mt-1 text-lg font-medium text-slate-800">Clocked out</p>
          </div>
          <Button className="w-full py-4 text-lg" disabled>
            Clock in
          </Button>
          <p className="text-xs text-slate-400">
            Punch actions activate in Phase 5 of the build plan.
          </p>
        </section>
      </main>
    </>
  );
}
