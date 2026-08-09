import { Redirect } from 'expo-router';
import { Loader, Screen } from '../src/components';
import { useSession } from '../src/session';

/** Aiguillage au démarrage, une fois la session restaurée depuis le trousseau. */
export default function Index() {
  const { status } = useSession();

  if (status === 'loading') {
    return (
      <Screen scroll={false}>
        <Loader label="Chargement…" />
      </Screen>
    );
  }

  return <Redirect href={status === 'authenticated' ? '/(tabs)' : '/(auth)/phone'} />;
}
