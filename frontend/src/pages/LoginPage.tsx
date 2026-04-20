import { useMutation } from '@tanstack/react-query';
import type { AuthResponse, LoginRequest } from '@vibept/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { ApiError, apiFetch } from '../lib/api';
import { authStore } from '../lib/auth-store';

export function LoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<LoginRequest>({
    email: '',
    password: '',
    rememberDevice: false,
  });

  const login = useMutation({
    mutationFn: (payload: LoginRequest) =>
      apiFetch<AuthResponse>('/auth/login', {
        method: 'POST',
        anonymous: true,
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      authStore.set(data);
      navigate('/', { replace: true });
    },
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-12">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Vibe Payroll Time</h1>
        <p className="mt-1 text-sm text-slate-600">Sign in to continue</p>
      </header>

      <form
        className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate(form);
        }}
      >
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
        <FormField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
        />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            checked={!!form.rememberDevice}
            onChange={(e) => setForm((f) => ({ ...f, rememberDevice: e.target.checked }))}
          />
          Remember this device
        </label>

        {login.isError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {login.error instanceof ApiError
              ? login.error.message
              : 'Sign in failed — please retry.'}
          </div>
        )}

        <Button type="submit" loading={login.isPending}>
          Sign in
        </Button>
      </form>
    </main>
  );
}
