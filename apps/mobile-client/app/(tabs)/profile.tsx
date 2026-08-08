import { palette, spacing, typography } from '@mobilite/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, ErrorNotice, Field, Loader, Row } from '../../src/components';
import { useSession } from '../../src/session';

/** Profil, assistance et déconnexion. */
export default function ProfileScreen() {
  const router = useRouter();
  const { api, profile, refreshProfile, signOut } = useSession();

  const [firstName, setFirstName] = useState(profile?.firstName ?? '');
  const [lastName, setLastName] = useState(profile?.lastName ?? '');
  const [email, setEmail] = useState(profile?.email ?? '');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!profile) {
    return (
      <SafeAreaView style={styles.screen} edges={['left', 'right']}>
        <Loader />
      </SafeAreaView>
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateClientProfile({
        firstName,
        lastName,
        email: email.trim() === '' ? null : email.trim(),
      });
      await refreshProfile();
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  function confirmSignOut() {
    Alert.alert('Se déconnecter ?', 'Vous devrez saisir un nouveau code pour revenir.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Se déconnecter',
        style: 'destructive',
        onPress: () =>
          void signOut().then(() => router.replace('/(auth)/phone')),
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ErrorNotice error={error} onRetry={save} />

        <Card>
          <Row label="Téléphone" value={profile.phone} />
          <Row label="Courses effectuées" value={profile.ridesCount} />
          <Row
            label="Votre note"
            value={profile.rating > 0 ? `${profile.rating.toFixed(1)} ★` : 'Pas encore de note'}
          />
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Vos informations</Text>
          <Field label="Prénom" value={firstName} onChangeText={setFirstName} />
          <Field label="Nom" value={lastName} onChangeText={setLastName} />
          <Field
            label="Adresse e-mail (facultative)"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            hint="Sert à recevoir vos reçus."
          />
          {saved ? <Text style={styles.saved}>Informations enregistrées.</Text> : null}
          <Button label="Enregistrer" onPress={save} loading={saving} />
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Assistance</Text>
          <Text style={styles.help}>
            Un problème sur une course — chauffeur absent, prix incorrect, objet oublié ? Ouvrez la
            course concernée depuis « Mes courses » pour signaler l’incident.
          </Text>
        </Card>

        <Button label="Se déconnecter" variant="danger" onPress={confirmSignOut} />

        <Text style={styles.privacy}>
          Vos données de localisation ne sont enregistrées que pendant vos courses, pour permettre le
          suivi, le calcul du prix et le traitement d’un éventuel litige.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surface0 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  sectionTitle: { ...typography.heading, color: palette.textPrimary, marginBottom: spacing.md },
  help: { ...typography.body, color: palette.textSecondary, lineHeight: 21 },
  saved: { ...typography.label, color: palette.good, marginBottom: spacing.sm },
  privacy: {
    ...typography.caption,
    color: palette.textMuted,
    marginTop: spacing.xl,
    lineHeight: 18,
  },
});
