import { palette } from '@mobilite/shared';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '../src/session';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: palette.surface0 },
            headerShadowVisible: false,
            headerTintColor: palette.textPrimary,
            contentStyle: { backgroundColor: palette.surface0 },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)/phone" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)/otp" options={{ title: 'Vérification' }} />
          <Stack.Screen name="onboarding" options={{ title: 'Mon dossier' }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="ride/[id]" options={{ title: 'Course en cours' }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
