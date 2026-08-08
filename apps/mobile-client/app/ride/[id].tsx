import {
  CLIENT_STATUS_HINTS,
  RIDE_STATUS_LABELS,
  formatAmount,
  isActiveRide,
  palette,
  radius,
  rideProgress,
  spacing,
  typography,
  type Coordinates,
  type RideDetail,
  type RideStatus,
} from '@mobilite/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { Button, Card, ErrorNotice, Loader, Pill, Row } from '../../src/components';
import { TRACKING_POLL_MS } from '../../src/config';
import { useSession } from '../../src/session';

/**
 * Suivi d'une course — §4, §6, §9 et §11.
 *
 * Deux sources alimentent l'écran :
 *  - le canal temps réel, qui pousse les changements d'état et la position du
 *    chauffeur ;
 *  - une interrogation périodique de repli.
 *
 * Le repli n'est pas une redondance inutile : sur un réseau mobile qui coupe,
 * un client qui ne voit plus son chauffeur n'a que faire de la raison technique.
 */
export default function RideScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { api, realtime } = useSession();
  const mapRef = useRef<MapView | null>(null);

  const [detail, setDetail] = useState<RideDetail | null>(null);
  const [driverPosition, setDriverPosition] = useState<Coordinates | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(0);
  const [connected, setConnected] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const result = await api.clientRide(id);
      setDetail(result);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Canal temps réel
  useEffect(() => {
    if (!id) return;

    realtime.connect({
      onConnectionChange: setConnected,
      onRideStatus: (event) => {
        if (event.rideId !== id) return;
        setDetail((current) =>
          current ? { ...current, ride: { ...current.ride, status: event.status } } : current,
        );
        // Le détail complet (montants, chauffeur) est rechargé : l'événement ne
        // porte que l'état.
        void load();
      },
      onDriverLocation: (event) => {
        if (event.rideId !== id) return;
        setDriverPosition({ latitude: event.latitude, longitude: event.longitude });
      },
    });
    realtime.subscribeToRide(id);

    return () => realtime.unsubscribeFromRide(id);
  }, [id, realtime, load]);

  // Repli : interrogation périodique tant que la course est active.
  useEffect(() => {
    const status = detail?.ride.status;
    if (!status || !isActiveRide(status)) return;

    const timer = setInterval(() => {
      void load();
      if (!id) return;
      void api
        .tracking(id)
        .then((result) => {
          if (result.position) setDriverPosition(result.position);
        })
        .catch(() => undefined);
    }, TRACKING_POLL_MS);

    return () => clearInterval(timer);
  }, [api, id, detail?.ride.status, load]);

  // Recentrage de la carte sur les points utiles.
  useEffect(() => {
    if (!detail) return;
    const points = [detail.ride.pickup, detail.ride.dropoff, driverPosition].filter(
      Boolean,
    ) as Coordinates[];
    if (points.length < 2) return;

    mapRef.current?.fitToCoordinates(points, {
      edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
      animated: true,
    });
  }, [detail, driverPosition]);

  if (!detail) {
    return (
      <View style={styles.screen}>
        <ErrorNotice error={error} onRetry={load} />
        <Loader label="Chargement de la course…" />
      </View>
    );
  }

  const { ride, driver, vehicle } = detail;
  const status = ride.status as RideStatus;
  const cancellable = ['requested', 'searching', 'driver_assigned', 'driver_en_route', 'driver_arrived'].includes(
    status,
  );

  async function act(action: () => Promise<unknown>, onDone?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      onDone?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function confirmCancel() {
    Alert.alert(
      'Annuler la course ?',
      status === 'driver_arrived'
        ? 'Votre chauffeur est déjà sur place : des frais d’annulation peuvent s’appliquer.'
        : 'Vous pouvez annuler sans frais à ce stade.',
      [
        { text: 'Non', style: 'cancel' },
        {
          text: 'Annuler la course',
          style: 'destructive',
          onPress: () =>
            void act(
              () => api.cancelRideAsClient(ride.id, 'Annulée par le client'),
              () => router.replace('/(tabs)'),
            ),
        },
      ],
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.mapWrapper}>
        <MapView ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={{ ...ride.pickup, latitudeDelta: 0.03, longitudeDelta: 0.03 }}>
          <Marker coordinate={ride.pickup} title="Départ" pinColor="#2a78d6" />
          <Marker coordinate={ride.dropoff} title="Destination" />
          {driverPosition ? (
            <Marker coordinate={driverPosition} title="Votre chauffeur" pinColor="#1a7f4b" />
          ) : null}
          {driverPosition ? (
            <Polyline
              coordinates={[driverPosition, status === 'in_progress' ? ride.dropoff : ride.pickup]}
              strokeColor={palette.clientAccent}
              strokeWidth={3}
            />
          ) : null}
        </MapView>
      </View>

      <ScrollView style={styles.sheet} contentContainerStyle={styles.sheetContent}>
        <View style={styles.statusHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>{RIDE_STATUS_LABELS[status]}</Text>
            <Text style={styles.statusHint}>{CLIENT_STATUS_HINTS[status] ?? ''}</Text>
          </View>
          <Pill tone={connected ? 'good' : 'warning'}>{connected ? 'En direct' : 'Hors ligne'}</Pill>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(rideProgress(status) * 100)}%` }]} />
        </View>

        <ErrorNotice error={error} onRetry={load} />

        {driver ? (
          <Card>
            <Row label="Chauffeur" value={`${driver.firstName} ${driver.lastName}`} />
            <Row label="Note" value={`${driver.rating.toFixed(1)} ★`} />
            {vehicle ? (
              <Row
                label="Véhicule"
                value={`${vehicle.make} ${vehicle.model} · ${vehicle.plate_number}`}
              />
            ) : null}
            <Button
              label="Appeler le chauffeur"
              variant="secondary"
              onPress={() => void Linking.openURL(`tel:${driver.phone}`)}
              style={{ marginTop: spacing.md }}
            />
          </Card>
        ) : null}

        <Card>
          <Row label="Référence" value={ride.reference} />
          <Row label="Départ" value={ride.pickup.address ?? 'Position choisie'} />
          <Row label="Destination" value={ride.dropoff.address ?? 'Point choisi'} />
          <Row
            label={ride.finalFare !== null ? 'Montant dû' : 'Estimation'}
            value={formatAmount(ride.amountDue ?? ride.estimatedFare, ride.currency)}
            emphasis
          />
          {ride.discount > 0 ? (
            <Row label="Remise appliquée" value={`−${formatAmount(ride.discount, ride.currency)}`} />
          ) : null}
          {ride.cancellationFee > 0 ? (
            <Row
              label="Frais d’annulation"
              value={formatAmount(ride.cancellationFee, ride.currency)}
            />
          ) : null}
        </Card>

        {status === 'awaiting_payment' && ride.paymentMethod !== 'cash' ? (
          <Button
            label={`Payer ${formatAmount(ride.amountDue, ride.currency)}`}
            onPress={() =>
              void act(async () => {
                const result = await api.payRide(ride.id);
                if (result.status === 'failed') {
                  Alert.alert('Paiement refusé', result.failureReason ?? 'Réessayez.');
                }
              })
            }
            loading={busy}
          />
        ) : null}

        {status === 'awaiting_payment' && ride.paymentMethod === 'cash' ? (
          <Card style={styles.info}>
            <Text style={styles.infoText}>
              Réglez {formatAmount(ride.amountDue, ride.currency)} en espèces à votre chauffeur. Il
              confirmera l’encaissement depuis son application.
            </Text>
          </Card>
        ) : null}

        {status === 'paid' ? (
          <Card>
            <Text style={styles.sectionTitle}>Notez votre chauffeur</Text>
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((value) => (
                <Pressable
                  key={value}
                  onPress={() => setRating(value)}
                  accessibilityRole="button"
                  accessibilityLabel={`${value} étoile${value > 1 ? 's' : ''}`}
                  hitSlop={8}
                >
                  <Text style={[styles.star, value <= rating && styles.starActive]}>★</Text>
                </Pressable>
              ))}
            </View>
            <Button
              label="Envoyer mon évaluation"
              onPress={() =>
                void act(
                  () => api.rateDriver(ride.id, rating),
                  () => router.replace('/(tabs)'),
                )
              }
              disabled={rating === 0}
              loading={busy}
            />
          </Card>
        ) : null}

        {status === 'rated' || status === 'cancelled' || status === 'expired' ? (
          <Button label="Retour à l’accueil" onPress={() => router.replace('/(tabs)')} />
        ) : null}

        {cancellable ? (
          <Button
            label="Annuler la course"
            variant="danger"
            onPress={confirmCancel}
            loading={busy}
            style={{ marginTop: spacing.md }}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surface0 },
  mapWrapper: { height: '35%', backgroundColor: palette.surface2 },
  sheet: { flex: 1 },
  sheetContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  statusHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  statusTitle: { ...typography.title, color: palette.textPrimary },
  statusHint: { ...typography.body, color: palette.textSecondary, marginTop: spacing.xs },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.surface2,
    marginVertical: spacing.lg,
    overflow: 'hidden',
  },
  progressFill: { height: 4, backgroundColor: palette.clientAccent },
  sectionTitle: { ...typography.heading, color: palette.textPrimary, marginBottom: spacing.md },
  stars: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  star: { fontSize: 36, color: palette.border },
  starActive: { color: '#eda100' },
  info: { backgroundColor: palette.warningBg, borderColor: palette.warning },
  infoText: { ...typography.body, color: palette.warning },
});
