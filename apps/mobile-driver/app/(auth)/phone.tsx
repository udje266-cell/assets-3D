import { cleanPhone, palette, spacing, typography } from '@mobilite/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, ErrorNotice, Field, Screen, Title, Wordmark } from '../../src/components';
import { useSession } from '../../src/session';

/** Inscription et connexion du chauffeur — §5. */
export default function PhoneScreen() {
  const router = useRouter();
  const { api } = useSession();

  const [phone, setPhone] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  const canSubmit = cleanPhone(phone).replace(/^\+/, '').length >= 8;

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const result = await api.requestOtp(cleanPhone(phone), 'driver');
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
      <Wordmark />

      <View style={styles.header}>
        <Title subtitle="Recevez des courses et suivez vos revenus.">Espace chauffeur</Title>
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

      <Button label="Recevoir mon code" onPress={submit} disabled={!canSubmit} loading={pending} />

      <Text style={styles.legal}>
        L’accès aux courses est ouvert après vérification de votre dossier : pièce d’identité,
        permis, documents du véhicule et assurance, selon les exigences applicables.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginTop: spacing.xl },
  legal: {
    ...typography.caption,
    color: palette.textMuted,
    marginTop: spacing.xl,
    lineHeight: 18,
  },
});
