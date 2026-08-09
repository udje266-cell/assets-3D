import { palette, spacing, typography } from '@mobilite/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, ErrorNotice, Field, Screen, Title } from '../../src/components';
import { useSession } from '../../src/session';

/**
 * Vérification du code et création du compte au premier passage.
 *
 * Le nom n'est demandé qu'aux nouveaux comptes : le §3 le prévoit à
 * l'inscription, il n'a pas à être ressaisi à chaque connexion. Il reste
 * facultatif côté serveur, mais un chauffeur qui vient chercher quelqu'un a
 * besoin d'un nom.
 */
export default function OtpScreen() {
  const router = useRouter();
  const { api, signIn } = useSession();
  const params = useLocalSearchParams<{ phone: string; devCode?: string }>();

  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [needsProfile, setNeedsProfile] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [resendIn, setResendIn] = useState(30);

  // En développement, le serveur renvoie le code : le pré-remplir évite de
  // chercher dans les journaux à chaque essai.
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
        accountType: 'client',
        code,
        ...(firstName ? { firstName } : {}),
        ...(lastName ? { lastName } : {}),
      });

      // Nouveau compte sans nom : on le demande avant d'entrer dans l'application.
      if (session.isNew && !firstName && !needsProfile) {
        setNeedsProfile(true);
        return;
      }

      await signIn();
      router.replace('/(tabs)');
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  async function saveProfileAndEnter() {
    setPending(true);
    setError(null);
    try {
      await api.updateClientProfile({ firstName, lastName });
      await signIn();
      router.replace('/(tabs)');
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      const result = await api.requestOtp(params.phone, 'client');
      if (result.code) setCode(result.code);
      setResendIn(30);
    } catch (err) {
      setError(err);
    }
  }

  if (needsProfile) {
    return (
      <Screen>
        <Title subtitle="Votre chauffeur saura qui il vient chercher.">Comment vous appelez-vous ?</Title>
        <ErrorNotice error={error} />
        <Field label="Prénom" value={firstName} onChangeText={setFirstName} autoFocus />
        <Field label="Nom" value={lastName} onChangeText={setLastName} />
        <Button
          label="Continuer"
          onPress={saveProfileAndEnter}
          disabled={firstName.trim().length === 0}
          loading={pending}
        />
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
