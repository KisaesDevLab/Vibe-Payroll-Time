import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TimeFormat } from '@vibept/shared';
import { formatHours } from '@vibept/shared';
import { FormatToggle } from '../components/FormatToggle';
import { TopBar } from '../components/TopBar';
import { ApiError } from '../lib/api';
import { userPreferences } from '../lib/resources';

/**
 * Per-user settings. Single field today — time format preference. Lives
 * as its own page so future additions (email display density, timezone
 * override, etc.) have a natural home.
 */
export function PreferencesPage(): JSX.Element {
  const qc = useQueryClient();

  const prefsQ = useQuery({
    queryKey: ['me-prefs'],
    queryFn: () => userPreferences.get(),
  });

  const update = useMutation({
    mutationFn: (next: TimeFormat | null) => userPreferences.update({ timeFormatPreference: next }),
    onSuccess: (data) => {
      qc.setQueryData(['me-prefs'], data);
      // Grids cache the effective format in their response; bust them.
      qc.invalidateQueries({ queryKey: ['weekly-grid'] });
      qc.invalidateQueries({ queryKey: ['multi-grid'] });
    },
  });

  const effective: TimeFormat = prefsQ.data?.timeFormatEffective ?? 'decimal';
  const inheriting = prefsQ.data?.timeFormatPreference == null;

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Preferences</h1>
          <p className="mt-1 text-sm text-slate-600">
            Applies to your account across every company.
          </p>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Time format</h2>
              <p className="mt-1 text-sm text-slate-600">
                How hours render throughout the app. Storage is always exact seconds, so switching
                never changes your data.
              </p>
            </div>
            <FormatToggle
              value={effective}
              onChange={(next) => update.mutate(next)}
              disabled={update.isPending || prefsQ.isLoading}
            />
          </div>

          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs uppercase tracking-wider text-slate-500">Live preview</div>
            <div className="mt-2 grid grid-cols-3 gap-4 text-sm">
              <Sample seconds={0} format={effective} label="No time" />
              <Sample seconds={5 * 3600 + 48 * 60} format={effective} label="5h 48m" />
              <Sample seconds={8 * 3600} format={effective} label="Full day" />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-slate-500">
              {inheriting ? 'Using the company default.' : 'Overriding the company default.'}
            </span>
            {!inheriting && (
              <button
                type="button"
                onClick={() => update.mutate(null)}
                disabled={update.isPending}
                className="text-xs uppercase tracking-wider text-slate-500 hover:text-slate-900 disabled:opacity-50"
              >
                Reset to company default
              </button>
            )}
          </div>

          {update.error && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {update.error instanceof ApiError
                ? update.error.message
                : 'Could not save preference.'}
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function Sample({
  seconds,
  format,
  label,
}: {
  seconds: number;
  format: TimeFormat;
  label: string;
}): JSX.Element {
  return (
    <div className="rounded bg-white px-3 py-2 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-lg text-slate-900">{formatHours(seconds, format)}</div>
    </div>
  );
}
