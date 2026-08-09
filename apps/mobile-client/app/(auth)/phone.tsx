import { cleanPhone, palette, spacing, typography } from '@mobilite/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, ErrorNotice, Field, Screen, Title, Wordmark } from '../../src/components';
import { useSession } from '../../src/session';

/**
 * Inscription et connexion par numéro de téléphone — §3.
 *
 * Aucun mot de passe : le numéro est l'identité, le code reçu par SMS est la
 * preuve. La réponse du serveur ne dit jamais si un compte existe déjà pour ce
 * numéro, et l'écran ne le laisse pas non plus deviner.
 */
export default function PhoneScreen() {
  const router = useRouter();
  const { api } = useSession();

  const [phone, setPhone] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  const digits = cleanPhone(phone).replace(/^\+/, '');
  const canSubmit = digits.length >= 8;

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const result = await api.requestOtp(cleanPhone(phone), 'client');
      router.push({
        pathname: '/(auth)/otp',
        params: { phone: cleanPhone(phone), devCode: result.code ?? '' },
      });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Wordmark />
        <Title subtitle="Commandez une course en quelques secondes.">Bienvenue</Title>
      </View>

      <ErrorNotice error={error} onRetry={submit} />

      <Field
        label="Numéro de téléphone"
        value={phone}
        onChangeText={setPhone}
        placeholder="07 00 00 00 01"
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        returnKeyType="send"
        onSubmitEditing={canSubmit ? submit : undefined}
        hint="Un code de vérification vous sera envoyé par SMS."
      />

      <Button
        label="Recevoir mon code"
        onPress={submit}
        disabled={!canSubmit}
        loading={pending}
      />

      <Text style={styles.legal}>
        En continuant, vous acceptez les conditions d’utilisation du service et le traitement de
        vos données de localisation pour la durée de vos courses.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginTop: spacing.xxl, gap: spacing.lg },
  legal: {
    ...typography.caption,
    color: palette.textMuted,
    marginTop: spacing.xl,
    lineHeight: 18,
  },
});
