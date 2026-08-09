import { Redirect } from 'expo-router';
import { Loader, Screen } from '../src/components';
import { useSession } from '../src/session';

/**
 * Aiguillage au démarrage.
 *
 * Un chauffeur dont le dossier n'est pas validé (§5) est dirigé vers la
 * constitution de son dossier : lui ouvrir l'écran de prise de courses
 * n'aurait aucun sens, le serveur refuserait toute mise en ligne.
 */
export default function Index() {
  const { status, profile } = useSession();

  if (status === 'loading') {
    return (
      <Screen scroll={false}>
        <Loader label="Chargement…" />
      </Screen>
    );
  }

  if (status === 'anonymous') return <Redirect href="/(auth)/phone" />;
  if (profile && profile.status !== 'approved') return <Redirect href="/onboarding" />;

  return <Redirect href="/(tabs)" />;
}
