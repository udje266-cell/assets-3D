import {
  RIDE_STATUS_LABELS,
  formatAmount,
  formatDateTime,
  isActiveRide,
  palette,
  spacing,
  typography,
  type Ride,
} from '@mobilite/shared';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, Empty, ErrorNotice, Loader, Pill } from '../../src/components';
import { useSession } from '../../src/session';

/** Historique des courses, reçus et évaluations — §3. */
export default function RidesScreen() {
  const router = useRouter();
  const { api } = useSession();

  const [rides, setRides] = useState<Ride[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { items } = await api.clientRides({ limit: 50 });
      setRides(items);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <ErrorNotice error={error} onRetry={load} />

        {rides === null ? <Loader /> : null}
        {rides?.length === 0 ? <Empty>Vous n’avez pas encore effectué de course.</Empty> : null}

        {rides?.map((ride) => (
          <Pressable
            key={ride.id}
            onPress={() => router.push({ pathname: '/ride/[id]', params: { id: ride.id } })}
            accessibilityRole="button"
          >
            <Card>
              <View style={styles.header}>
                <Text style={styles.reference}>{ride.reference}</Text>
                <Pill tone={tone(ride.status)}>{RIDE_STATUS_LABELS[ride.status]}</Pill>
              </View>

              <Text style={styles.route}>
                {ride.pickup.address ?? 'Départ'} → {ride.dropoff.address ?? 'Destination'}
              </Text>

              <View style={styles.footer}>
                <Text style={styles.date}>{formatDateTime(ride.createdAt)}</Text>
                <Text style={styles.amount}>
                  {formatAmount(ride.amountDue ?? ride.estimatedFare, ride.currency)}
                </Text>
              </View>

              {isActiveRide(ride.status) ? (
                <Text style={styles.active}>Course en cours — touchez pour la suivre</Text>
              ) : null}
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function tone(status: string): 'neutral' | 'good' | 'warning' | 'critical' {
  if (['paid', 'rated'].includes(status)) return 'good';
  if (['cancelled', 'expired'].includes(status)) return 'critical';
  if (['awaiting_payment', 'searching', 'requested'].includes(status)) return 'warning';
  return 'neutral';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surface0 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  reference: { ...typography.label, color: palette.textMuted },
  route: { ...typography.body, color: palette.textPrimary, marginBottom: spacing.sm },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { ...typography.caption, color: palette.textMuted },
  amount: { ...typography.heading, color: palette.textPrimary },
  active: { ...typography.caption, color: palette.clientAccent, marginTop: spacing.sm },
});
