import { palette, radius, spacing, typography } from '@mobilite/shared';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Éléments d'interface communs à l'application chauffeur. */

const ACCENT = palette.driverAccent;

/** Rapport largeur/hauteur de assets/wordmark.png, engendré par tools/brand. */
const WORDMARK_RATIO = 7.47;

/**
 * Logotype URIGO.
 *
 * Le logotype est blanc et orange sur fond noir. Il est posé sur une plaque
 * noire plutôt que détouré : c'est ce qui garantit que ses couleurs restent
 * exactement celles de la marque, quel que soit le fond de l'écran.
 */
export function Wordmark({ height = 30 }: { height?: number }) {
  return (
    <View style={[styles.wordmark, { padding: height * 0.5, borderRadius: height * 0.55 }]}>
      <Image
        source={require('../assets/wordmark.png')}
        style={{ height, width: height * WORDMARK_RATIO }}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="URIGO"
      />
    </View>
  );
}

export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
}) {
  const content = <View style={[styles.screenInner, style]}>{children}</View>;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

export function Title({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={styles.title}>{children}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(inactive) }}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && { backgroundColor: ACCENT },
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        inactive && styles.buttonDisabled,
        pressed && !inactive && { opacity: 0.85 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? palette.textInverse : ACCENT} />
      ) : (
        <Text
          style={[
            styles.buttonLabel,
            variant !== 'primary' && { color: variant === 'danger' ? palette.critical : ACCENT },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  ...props
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={palette.textMuted}
        {...props}
        style={[styles.input, props.style]}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, emphasis && styles.rowValueStrong]}>{value}</Text>
    </View>
  );
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warning' | 'critical';
}) {
  const tones = {
    neutral: { bg: palette.surface2, fg: palette.textSecondary },
    good: { bg: palette.goodBg, fg: palette.good },
    warning: { bg: palette.warningBg, fg: palette.warning },
    critical: { bg: palette.criticalBg, fg: palette.critical },
  } as const;

  return (
    <View style={[styles.pill, { backgroundColor: tones[tone].bg }]}>
      <Text style={[styles.pillText, { color: tones[tone].fg }]}>{children}</Text>
    </View>
  );
}

/**
 * Message d'erreur.
 *
 * Une panne réseau et une erreur métier n'appellent pas la même réaction :
 * la première mérite un bouton « Réessayer », la seconde une explication.
 */
export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;

  const message = error instanceof Error ? error.message : String(error);
  const isNetwork =
    typeof error === 'object' &&
    error !== null &&
    'isNetwork' in error &&
    (error as { isNetwork: boolean }).isNetwork;

  return (
    <View style={styles.error}>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry && isNetwork ? (
        <Pressable onPress={onRetry} accessibilityRole="button">
          <Text style={styles.errorRetry}>Réessayer</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Loader({ label }: { label?: string }) {
  return (
    <View style={styles.loader}>
      <ActivityIndicator color={ACCENT} />
      {label ? <Text style={styles.loaderLabel}>{label}</Text> : null}
    </View>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <Text style={styles.empty}>{children}</Text>;
}

const styles = StyleSheet.create({
  wordmark: { backgroundColor: palette.brandBlack, alignSelf: 'flex-start' },
  screen: { flex: 1, backgroundColor: palette.surface0 },
  screenInner: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  title: { ...typography.title, color: palette.textPrimary },
  subtitle: { ...typography.body, color: palette.textSecondary, marginTop: spacing.xs },
  card: {
    backgroundColor: palette.surface1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  button: {
    borderRadius: radius.sm,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  buttonSecondary: {
    backgroundColor: palette.surface1,
    borderWidth: 1,
    borderColor: palette.borderStrong,
  },
  buttonDanger: {
    backgroundColor: palette.surface1,
    borderWidth: 1,
    borderColor: palette.critical,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonLabel: { ...typography.heading, color: palette.textInverse },
  label: { ...typography.label, color: palette.textSecondary, marginBottom: spacing.xs },
  input: {
    backgroundColor: palette.surface1,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: palette.textPrimary,
    minHeight: 48,
  },
  hint: { ...typography.caption, color: palette.textMuted, marginTop: spacing.xs },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    gap: spacing.md,
  },
  rowLabel: { ...typography.body, color: palette.textSecondary, flexShrink: 1 },
  rowValue: { ...typography.body, color: palette.textPrimary, fontWeight: '500' },
  rowValueStrong: { ...typography.heading, color: palette.textPrimary },
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  pillText: { ...typography.label },
  error: {
    backgroundColor: palette.criticalBg,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { ...typography.body, color: palette.critical },
  errorRetry: {
    ...typography.label,
    color: palette.critical,
    textDecorationLine: 'underline',
    marginTop: spacing.sm,
  },
  loader: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  loaderLabel: { ...typography.body, color: palette.textSecondary },
  empty: {
    ...typography.body,
    color: palette.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});
