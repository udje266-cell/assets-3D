import { DRIVER_STATUS_LABELS, palette, spacing, typography } from '@mobilite/shared';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, ErrorNotice, Loader, Pill, Row } from '../../src/components';
import { useSession } from '../../src/session';

/** Profil du chauffeur, dossier et déconnexion — §5. */
export default function ProfileScreen() {
  const router = useRouter();
  const { profile, refreshProfile, signOut } = useSession();

  const [vehicles, setVehicles] = useState<Array<{ id: string; make: string; model: string; plate_number: string }>>([]);
  const [documents, setDocuments] = useState<Array<{ id: string; doc_type: string; status: string }>>([]);
  const [error, setError] = useState<unknown>(null);
  const { api } = useSession();

  const load = useCallback(async () => {
    try {
      const [vehiclesResult, documentsResult] = await Promise.all([
        api.driverVehicles(),
        api.driverDocuments(),
      ]);
      setVehicles(vehiclesResult.items);
      setDocuments(documentsResult.items);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void load();
      void refreshProfile();
    }, [load, refreshProfile]),
  );

  if (!profile) {
    return (
      <SafeAreaView style={styles.screen} edges={['left', 'right']}>
        <Loader />
      </SafeAreaView>
    );
  }

  function confirmSignOut() {
    Alert.alert(
      'Se déconnecter ?',
      'Vous ne recevrez plus de courses jusqu’à votre prochaine connexion.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Se déconnecter',
          style: 'destructive',
          onPress: () => void signOut().then(() => router.replace('/(auth)/phone')),
        },
      ],
    );
  }

  const pendingDocuments = documents.filter((document) => document.status === 'pending').length;

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ErrorNotice error={error} onRetry={load} />

        <Card>
          <Text style={styles.name}>
            {profile.firstName} {profile.lastName}
          </Text>
          <Pill tone={profile.status === 'approved' ? 'good' : 'warning'}>
            {DRIVER_STATUS_LABELS[profile.status] ?? profile.status}
          </Pill>

          <Row label="Téléphone" value={profile.phone} />
          <Row label="Courses effectuées" value={profile.ridesCount} />
          <Row
            label="Note moyenne"
            value={profile.rating > 0 ? `${profile.rating.toFixed(1)} ★` : 'Pas encore de note'}
          />
          <Row
            label="Taux d’acceptation"
            value={profile.acceptanceRate !== null ? `${profile.acceptanceRate} %` : '—'}
          />
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Mon véhicule</Text>
          {vehicles.length === 0 ? (
            <Text style={styles.muted}>Aucun véhicule déclaré.</Text>
          ) : (
            vehicles.map((vehicle) => (
              <Row
                key={vehicle.id}
                label={`${vehicle.make} ${vehicle.model}`}
                value={vehicle.plate_number}
              />
            ))
          )}
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Mes documents</Text>
          {documents.map((document) => (
            <Row
              key={document.id}
              label={document.doc_type}
              value={
                document.status === 'approved'
                  ? 'Validé'
                  : document.status === 'rejected'
                    ? 'Refusé'
                    : 'En examen'
              }
            />
          ))}
          {pendingDocuments > 0 ? (
            <Text style={styles.muted}>
              {pendingDocuments} document(s) en attente d’examen par la plateforme.
            </Text>
          ) : null}
          <Button
            label="Gérer mon dossier"
            variant="secondary"
            onPress={() => router.push('/onboarding')}
            style={{ marginTop: spacing.md }}
          />
        </Card>

        <Button label="Se déconnecter" variant="danger" onPress={confirmSignOut} />

        <Text style={styles.privacy}>
          Votre position n’est transmise que lorsque vous êtes en service, pour vous proposer des
          courses et permettre au client de suivre son trajet.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surface0 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  name: { ...typography.title, color: palette.textPrimary, marginBottom: spacing.sm },
  sectionTitle: { ...typography.heading, color: palette.textPrimary, marginBottom: spacing.md },
  muted: { ...typography.body, color: palette.textMuted },
  privacy: {
    ...typography.caption,
    color: palette.textMuted,
    marginTop: spacing.xl,
    lineHeight: 18,
  },
});
