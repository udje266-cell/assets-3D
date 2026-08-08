import {
  RIDE_STATUS_LABELS,
  formatAmount,
  palette,
  rideProgress,
  spacing,
  typography,
  type Ride,
  type RideStatus,
} from '@mobilite/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Button, Card, ErrorNotice, Loader, Row } from '../../src/components';
import { useSession } from '../../src/session';

/**
 * Déroulement d'une course côté chauffeur — §6.
 *
 * Un seul bouton d'action à la fois, correspondant à la seule transition
 * autorisée depuis l'état courant : le chauffeur conduit, il n'a pas à choisir
 * dans une liste. La machine à états du serveur reste l'autorité — l'écran ne
 * fait qu'exposer la transition suivante.
 */

interface Step {
  label: string;
  run: () => Promise<unknown>;
  variant?: 'primary' | 'secondary';
}

export default function DriverRideScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { api } = useSession();
  const mapRef = useRef<MapView | null>(null);

  const [ride, setRide] = useState<Ride | null>(null);
  const [client, setClient] = useState<{ firstName: string | null; lastName: string | null; phone: string; rating: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(0);
  const [settlement, setSettlement] = useState<{ amountDue: number; commission: number; driverAmount: number } | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const result = await api.driverRide(id);
      setRide(result.ride);
      setClient(result.client);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!ride) return;
    mapRef.current?.fitToCoordinates([ride.pickup, ride.dropoff], {
      edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
      animated: true,
    });
  }, [ride]);

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

  if (!ride) {
    return (
      <View style={styles.screen}>
        <ErrorNotice error={error} onRetry={load} />
        <Loader label="Chargement de la course…" />
      </View>
    );
  }

  const status = ride.status as RideStatus;

  /** Transition suivante autorisée depuis l'état courant. */
  const step: Step | null = (() => {
    switch (status) {
      case 'driver_assigned':
        return {
          label: 'Je pars chercher le client',
          run: () => api.advanceRide(ride.id, 'en-route'),
        };
      case 'driver_en_route':
        return {
          label: 'Je suis arrivé au point de départ',
          run: () => api.advanceRide(ride.id, 'arrived'),
        };
      case 'driver_arrived':
        return {
          label: 'Passager à bord — démarrer la course',
          run: () => api.advanceRide(ride.id, 'start'),
        };
      case 'in_progress':
        return {
          label: 'Terminer la course',
          run: async () => {
            const result = await api.completeRide(ride.id, {});
            setSettlement({
              amountDue: result.amountDue,
              commission: result.commission,
              driverAmount: result.driverAmount,
            });
          },
        };
      case 'awaiting_payment':
        return ride.paymentMethod === 'cash'
          ? {
              label: `Encaissement de ${formatAmount(ride.amountDue, ride.currency)} confirmé`,
              run: () => api.collectCash(ride.id),
            }
          : null;
      default:
        return null;
    }
  })();

  const cancellable = ['driver_assigned', 'driver_en_route', 'driver_arrived'].includes(status);
  const finished = ['paid', 'rated', 'cancelled', 'expired'].includes(status);
  // Capturé ici : dans un rappel différé, TypeScript ne conserve pas le
  // rétrécissement de type obtenu par le retour anticipé ci-dessus.
  const rideId = ride.id;

  function confirmCancel() {
    Alert.alert(
      'Annuler cette course ?',
      'Une annulation répétée peut affecter votre accès aux courses.',
      [
        { text: 'Non', style: 'cancel' },
        {
          text: 'Annuler la course',
          style: 'destructive',
          onPress: () =>
            void act(
              () => api.cancelRideAsDriver(rideId, 'Annulée par le chauffeur'),
              () => router.replace('/(tabs)'),
            ),
        },
      ],
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.mapWrapper}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={{ ...ride.pickup, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
          showsUserLocation
        >
          <Marker coordinate={ride.pickup} title="Départ" pinColor="#2a78d6" />
          <Marker coordinate={ride.dropoff} title="Destination" />
        </MapView>
      </View>

      <ScrollView style={styles.sheet} contentContainerStyle={styles.sheetContent}>
        <Text style={styles.statusTitle}>{RIDE_STATUS_LABELS[status]}</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(rideProgress(status) * 100)}%` }]} />
        </View>

        <ErrorNotice error={error} onRetry={load} />

        <Card>
          <Row label="Référence" value={ride.reference} />
          <Row label="Départ" value={ride.pickup.address ?? 'Position du client'} />
          <Row label="Destination" value={ride.dropoff.address ?? 'Point choisi'} />
          <Row
            label="Paiement"
            value={ride.paymentMethod === 'cash' ? 'Espèces' : 'Électronique'}
          />
          <Row
            label={ride.finalFare !== null ? 'Montant de la course' : 'Estimation'}
            value={formatAmount(ride.amountDue ?? ride.estimatedFare, ride.currency)}
            emphasis
          />
        </Card>

        {client ? (
          <Card>
            <Row
              label="Client"
              value={[client.firstName, client.lastName].filter(Boolean).join(' ') || 'Client'}
            />
            <Row
              label="Note"
              value={client.rating > 0 ? `${client.rating.toFixed(1)} ★` : 'Nouveau client'}
            />
            <Button
              label="Appeler le client"
              variant="secondary"
              onPress={() => void Linking.openURL(`tel:${client.phone}`)}
              style={{ marginTop: spacing.md }}
            />
          </Card>
        ) : null}

        {settlement ? (
          <Card style={styles.settlement}>
            <Text style={styles.settlementTitle}>Décompte de la course</Text>
            <Row label="Montant dû par le client" value={formatAmount(settlement.amountDue, ride.currency)} />
            <Row label="Commission plateforme" value={formatAmount(settlement.commission, ride.currency)} />
            <Row label="Votre part" value={formatAmount(settlement.driverAmount, ride.currency)} emphasis />
            {ride.paymentMethod === 'cash' ? (
              <Text style={styles.settlementNote}>
                Vous encaissez la totalité auprès du client ; la commission est portée au débit de
                votre portefeuille.
              </Text>
            ) : (
              <Text style={styles.settlementNote}>
                Le client règle par voie électronique ; votre part est créditée sur votre
                portefeuille.
              </Text>
            )}
          </Card>
        ) : null}

        {step ? (
          <Button
            label={step.label}
            onPress={() => void act(step.run)}
            loading={busy}
            style={{ marginTop: spacing.md }}
          />
        ) : null}

        {status === 'awaiting_payment' && ride.paymentMethod !== 'cash' ? (
          <Card style={styles.info}>
            <Text style={styles.infoText}>
              En attente du règlement par le client. Vous serez crédité dès sa confirmation.
            </Text>
          </Card>
        ) : null}

        {status === 'paid' ? (
          <Card>
            <Text style={styles.sectionTitle}>Notez votre client</Text>
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
              label="Envoyer et terminer"
              onPress={() =>
                void act(
                  () => api.rateClient(ride.id, rating),
                  () => router.replace('/(tabs)'),
                )
              }
              disabled={rating === 0}
              loading={busy}
            />
            <Button
              label="Passer"
              variant="secondary"
              onPress={() => router.replace('/(tabs)')}
              style={{ marginTop: spacing.sm }}
            />
          </Card>
        ) : null}

        {finished && status !== 'paid' ? (
          <Button label="Retour au service" onPress={() => router.replace('/(tabs)')} />
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
  mapWrapper: { height: '30%', backgroundColor: palette.surface2 },
  sheet: { flex: 1 },
  sheetContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  statusTitle: { ...typography.title, color: palette.textPrimary },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.surface2,
    marginVertical: spacing.lg,
    overflow: 'hidden',
  },
  progressFill: { height: 4, backgroundColor: palette.driverAccent },
  sectionTitle: { ...typography.heading, color: palette.textPrimary, marginBottom: spacing.md },
  settlement: { borderColor: palette.driverAccent, borderWidth: 2 },
  settlementTitle: { ...typography.heading, color: palette.textPrimary, marginBottom: spacing.sm },
  settlementNote: { ...typography.caption, color: palette.textMuted, marginTop: spacing.sm },
  stars: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  star: { fontSize: 36, color: palette.border },
  starActive: { color: '#eda100' },
  info: { backgroundColor: palette.warningBg, borderColor: palette.warning },
  infoText: { ...typography.body, color: palette.warning },
});
