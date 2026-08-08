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

/**
 * Historique des courses du chauffeur — §5.
 *
 * L'API ajoute la part chauffeur à chaque ligne : c'est le chiffre qui
 * intéresse le chauffeur, davantage que le prix payé par le client.
 */
interface DriverRide extends Ride {
  driverAmount: number;
  platformAmount: number;
}

export default function HistoryScreen() {
  const router = useRouter();
  const { api } = useSession();

  const [rides, setRides] = useState<DriverRide[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { items } = await api.driverRides({ limit: 50 });
      setRides(items as DriverRide[]);
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
        {rides?.length === 0 ? <Empty>Aucune course effectuée pour le moment.</Empty> : null}

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
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.amount}>
                    {formatAmount(ride.finalFare ?? ride.estimatedFare, ride.currency)}
                  </Text>
                  {ride.finalFare !== null ? (
                    <Text style={styles.share}>
                      Votre part : {formatAmount(ride.driverAmount, ride.currency)}
                    </Text>
                  ) : null}
                </View>
              </View>

              {isActiveRide(ride.status) ? (
                <Text style={styles.active}>Course en cours — touchez pour la reprendre</Text>
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
  if (['awaiting_payment'].includes(status)) return 'warning';
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
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  date: { ...typography.caption, color: palette.textMuted },
  amount: { ...typography.heading, color: palette.textPrimary },
  share: { ...typography.caption, color: palette.textMuted },
  active: { ...typography.caption, color: palette.driverAccent, marginTop: spacing.sm },
});
