import { palette, spacing, typography } from '@mobilite/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, ErrorNotice, Field, Screen, Title } from '../../src/components';
import { useSession } from '../../src/session';

/**
 * Vérification du code et création du compte chauffeur.
 *
 * Contrairement au client, le nom est **obligatoire** dès la création : c'est
 * la base du dossier de vérification exigé au §5, et le serveur refuse la
 * création d'un compte chauffeur sans identité.
 */
export default function OtpScreen() {
  const router = useRouter();
  const { api, signIn } = useSession();
  const params = useLocalSearchParams<{ phone: string; devCode?: string }>();

  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [needsIdentity, setNeedsIdentity] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [resendIn, setResendIn] = useState(30);

  useEffect(() => {
    if (params.devCode) setCode(params.devCode);
  }, [params.devCode]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((value) => value - 1), 1_000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const session = await api.verifyOtp({
        phone: params.phone,
        accountType: 'driver',
        code,
        ...(firstName ? { firstName } : {}),
        ...(lastName ? { lastName } : {}),
      });

      await signIn();
      router.replace(session.account.status === 'approved' ? '/(tabs)' : '/onboarding');
    } catch (err) {
      // Le serveur exige nom et prénom pour créer un compte chauffeur : on les
      // demande au lieu d'afficher une erreur que l'utilisateur ne peut résoudre.
      if (
        typeof err === 'object' &&
        err !== null &&
        'message' in err &&
        String((err as Error).message).includes('Nom et prénom')
      ) {
        setNeedsIdentity(true);
      } else {
        setError(err);
      }
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      const result = await api.requestOtp(params.phone, 'driver');
      if (result.code) setCode(result.code);
      setResendIn(30);
    } catch (err) {
      setError(err);
    }
  }

  if (needsIdentity) {
    return (
      <Screen>
        <Title subtitle="Votre identité figure sur votre dossier et s’affiche au client.">
          Votre identité
        </Title>
        <ErrorNotice error={error} />
        <Field label="Prénom" value={firstName} onChangeText={setFirstName} autoFocus />
        <Field label="Nom" value={lastName} onChangeText={setLastName} />
        <Field
          label="Code de vérification"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          maxLength={8}
          hint="Redemandez un code s’il a expiré entre-temps."
        />
        <Button
          label="Créer mon compte"
          onPress={submit}
          disabled={!firstName.trim() || !lastName.trim() || code.length < 4}
          loading={pending}
        />
        <View style={styles.resend}>
          <Button label="Renvoyer le code" variant="secondary" onPress={resend} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title subtitle={`Code envoyé au ${params.phone}.`}>Entrez votre code</Title>

      <ErrorNotice error={error} onRetry={submit} />

      <Field
        label="Code de vérification"
        value={code}
        onChangeText={setCode}
        placeholder="123456"
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={8}
        autoFocus
        style={styles.codeInput}
      />

      <Button label="Vérifier" onPress={submit} disabled={code.length < 4} loading={pending} />

      <View style={styles.resend}>
        {resendIn > 0 ? (
          <Text style={styles.resendText}>Nouveau code possible dans {resendIn} s</Text>
        ) : (
          <Button label="Renvoyer le code" variant="secondary" onPress={resend} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  codeInput: { fontSize: 24, letterSpacing: 8, textAlign: 'center' },
  resend: { marginTop: spacing.lg, alignItems: 'center' },
  resendText: { ...typography.body, color: palette.textMuted },
});
