import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Logo, Button, Input, Alert, Spinner } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { startZoneSession, validateZoneToken } from '@/lib/zoneApi';

/** Page publique d'entrée « zone responsable » (accès par code, sans compte). */
export default function ZoneEntryPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['zoneValidate', token],
    queryFn: () => validateZoneToken(token!),
    enabled: Boolean(token),
  });

  useEffect(() => {
    if (data?.valid && data.responsible_name) {
      setName((prev) => (prev ? prev : data.responsible_name ?? ''));
    }
  }, [data]);

  const formattedDate = data?.event_date
    ? new Date(data.event_date).toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '';

  async function handleEnter() {
    if (!token) return;
    if (name.trim().length < 2) {
      showToast('Veuillez saisir votre nom (2 caractères minimum).', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await startZoneSession(token, name.trim());
      localStorage.setItem(`zone:${token}:name`, name.trim());
      navigate(`/zone/${token}/dashboard`);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Impossible d’ouvrir la session.',
        'warning',
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-pr-cream px-4 py-10">
      <div className="w-full max-w-md space-y-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-pr-stone">
        <div className="flex flex-col items-center gap-3">
          <Logo variant="mark" size="lg" />
        </div>

        {isLoading ? (
          <Spinner fullPage label="Vérification du code…" />
        ) : !data?.valid ? (
          <Alert variant="error" title="Code invalide ou expiré">
            Contactez l’équipe stade.
          </Alert>
        ) : (
          <>
            <div className="text-center">
              <h1 className="text-lg font-semibold text-pr-black">
                {data.event_name} — {data.space_name}
              </h1>
              <p className="mt-1 text-sm capitalize text-pr-black-soft">
                {formattedDate}
                {data.start_time ? ` · ${data.start_time.slice(0, 5)}` : ''}
              </p>
            </div>

            <Input
              label="Votre nom *"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex : Marie Dupont"
              className="min-h-[44px]"
              autoComplete="name"
            />

            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={submitting}
              onClick={handleEnter}
              className="min-h-[44px]"
            >
              Accéder à mon espace
            </Button>

            <p className="text-center text-xs text-pr-black-soft/80">
              (Si le code ne fonctionne pas, contactez l’équipe stade)
            </p>
          </>
        )}
      </div>
    </div>
  );
}
