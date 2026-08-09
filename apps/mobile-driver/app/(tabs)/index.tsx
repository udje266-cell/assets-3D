import {
  DEFAULT_REGION,
  formatAmount,
  formatDistance,
  formatDuration,
  isActiveRide,
  palette,
  secondsUntil,
  spacing,
  typography,
  type RideOffer,
} from '@mobilite/shared';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, ErrorNotice, Pill, Row } from '../../src/components';
import { LOCATION_INTERVAL_MS, OFFER_POLL_MS } from '../../src/config';
import { useSession } from '../../src/session';

/**
 * Écran de service — §5 et §19.
 *
 * Trois responsabilités :
 *  - basculer entre « en ligne » et « hors ligne » ;
 *  - publier la position tant que le chauffeur est en service, faute de quoi
 *    l'attribution l'écarte : le serveur ne propose pas de course à un
 *    chauffeur dont la dernière position date de plus de deux minutes ;
 *  - présenter l'offre reçue avec son délai, et permettre de l'accepter ou de
 *    la refuser.
 *
 * L'offre arrive par le canal temps réel, doublée d'une interrogation
 * périodique : rater une offre coûte une course au chauffeur et une attente au
 * client, cela ne doit pas dépendre d'une seule voie de transmission.
 */
export default function ServiceScreen() {
  const router = useRouter();
  const { api, realtime, profile, refreshProfile } = useSession();

  const [online, setOnline] = useState(false);
  const [offer, setOffer] = useState<RideOffer | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);

  const watcher = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    setOnline(profile?.availability === 'online' || profile?.availability === 'on_ride');
  }, [profile?.availability]);

  // Une course déjà en cours prend la main sur l'écran de service.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        try {
          const { ride } = await api.currentDriverRide();
          if (!cancelled && ride && isActiveRide(ride.status)) {
            router.replace({ pathname: '/ride/[id]', params: { id: ride.id } });
          }
        } catch {
          // Hors réseau : on reste sur l'écran de service.
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [api, router]),
  );

  // Canal temps réel : réception immédiate des offres.
  useEffect(() => {
    realtime.connect({
      onConnectionChange: setConnected,
      onRideOffer: (event) => {
        setOffer({
          offerId: event.offerId,
          rideId: event.rideId,
          reference: event.reference,
          expiresAt: event.expiresAt,
          distanceMeters: event.distanceToPickupMeters,
          etaSeconds: event.etaSeconds,
          pickup_latitude: event.pickup.latitude,
          pickup_longitude: event.pickup.longitude,
          pickup_address: event.pickup.address,
          dropoff_latitude: event.dropoff.latitude,
          dropoff_longitude: event.dropoff.longitude,
          dropoff_address: event.dropoff.address,
          estimated_fare: event.estimatedFare,
          currency: event.currency,
          payment_method: 'cash',
        });
      },
    });
  }, [realtime]);

  // Interrogation de repli des offres.
  useEffect(() => {
    if (!online) {
      setOffer(null);
      return;
    }

    const poll = () => {
      void api
        .currentOffer()
        .then(({ offer: current }) => setOffer(current))
        .catch(() => undefined);
    };

    poll();
    const timer = setInterval(poll, OFFER_POLL_MS);
    return () => clearInterval(timer);
  }, [api, online]);

  // Compte à rebours de l'offre en cours.
  useEffect(() => {
    if (!offer) {
      setRemaining(0);
      return;
    }

    const tick = () => {
      const left = secondsUntil(offer.expiresAt);
      setRemaining(left);
      if (left === 0) setOffer(null);
    };

    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [offer]);

  // Publication de la position tant que le chauffeur est en service.
  useEffect(() => {
    if (!online) {
      watcher.current?.remove();
      watcher.current = null;
      return;
    }

    let cancelled = false;

    void (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError(
          new Error(
            'La localisation est indispensable pour recevoir des courses. Autorisez-la dans les réglages.',
          ),
        );
        setOnline(false);
        return;
      }

      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: LOCATION_INTERVAL_MS,
          distanceInterval: 25,
        },
        (update) => {
          const coords = {
            latitude: update.coords.latitude,
            longitude: update.coords.longitude,
          };
          setPosition(coords);

          // Le canal temps réel est privilégié ; l'appel REST garantit
          // l'enregistrement même si le socket est coupé.
          realtime.publishLocation({
            ...coords,
            ...(update.coords.heading !== null ? { heading: update.coords.heading } : {}),
          });
          void api
            .publishLocation({
              ...coords,
              ...(update.coords.heading !== null ? { heading: update.coords.heading } : {}),
            })
            .catch(() => undefined);
        },
      );

      if (cancelled) subscription.remove();
      else watcher.current = subscription;
    })();

    return () => {
      cancelled = true;
      watcher.current?.remove();
      watcher.current = null;
    };
  }, [online, api, realtime]);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.setAvailability(next);
      setOnline(next);
      await refreshProfile();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!offer) return;
    setBusy(true);
    setError(null);
    try {
      const { ride } = await api.acceptOffer(offer.offerId);
      setOffer(null);
      router.replace({ pathname: '/ride/[id]', params: { id: ride.id } });
    } catch (err) {
      setError(err);
      // Offre expirée ou reprise par un autre : on la retire de l'écran.
      setOffer(null);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!offer) return;
    setBusy(true);
    try {
      await api.rejectOffer(offer.offerId, 'Refusée par le chauffeur');
    } catch {
      // Une offre déjà close n'a pas besoin d'être signalée.
    } finally {
      setOffer(null);
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <View style={styles.mapWrapper}>
        <MapView
          style={StyleSheet.absoluteFill}
          initialRegion={DEFAULT_REGION}
          showsUserLocation
          followsUserLocation={online}
        >
          {offer ? (
            <Marker
              coordinate={{ latitude: offer.pickup_latitude, longitude: offer.pickup_longitude }}
              title="Point de départ"
              description={offer.pickup_address ?? undefined}
              pinColor="#2a78d6"
            />
          ) : null}
        </MapView>
      </View>

      <ScrollView style={styles.sheet} contentContainerStyle={styles.sheetContent}>
        <ErrorNotice error={error} />

        <Card>
          <View style={styles.statusRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusTitle}>{online ? 'En service' : 'Hors service'}</Text>
              <Text style={styles.statusHint}>
                {online
                  ? 'Vous recevez les courses proches de vous.'
                  : 'Passez en ligne pour recevoir des courses.'}
              </Text>
            </View>
            <Switch
              value={online}
              onValueChange={(value) => void toggle(value)}
              disabled={busy}
              trackColor={{ true: palette.driverAccent, false: palette.border }}
            />
          </View>

          <View style={styles.badges}>
            <Pill tone={connected ? 'good' : 'warning'}>
              {connected ? 'Connecté en direct' : 'Connexion dégradée'}
            </Pill>
            {position ? <Pill tone="neutral">Position transmise</Pill> : null}
          </View>
        </Card>

        {offer ? (
          <Card style={styles.offer}>
            <View style={styles.offerHeader}>
              <Text style={styles.offerTitle}>Nouvelle course</Text>
              <Text style={styles.countdown}>{remaining} s</Text>
            </View>

            <View style={styles.countdownTrack}>
              <View
                style={[
                  styles.countdownFill,
                  { width: `${Math.min(100, (remaining / 20) * 100)}%` },
                ]}
              />
            </View>

            <Row label="Départ" value={offer.pickup_address ?? 'Position du client'} />
            <Row label="Destination" value={offer.dropoff_address ?? 'Point choisi'} />
            <Row
              label="Distance jusqu’au client"
              value={`${formatDistance(offer.distanceMeters)} · ${formatDuration(offer.etaSeconds)}`}
            />
            <Row
              label="Estimation de la course"
              value={formatAmount(offer.estimated_fare, offer.currency)}
              emphasis
            />

            <Button label="Accepter" onPress={accept} loading={busy} style={{ marginTop: spacing.md }} />
            <Button
              label="Refuser"
              variant="secondary"
              onPress={reject}
              disabled={busy}
              style={{ marginTop: spacing.sm }}
            />
          </Card>
        ) : online ? (
          <Card>
            <Text style={styles.waiting}>En attente d’une course…</Text>
            <Text style={styles.waitingHint}>
              Restez dans une zone de demande. Votre taux d’acceptation influence l’ordre des
              propositions.
            </Text>
          </Card>
        ) : null}

        {profile ? (
          <Card>
            <Row label="Courses effectuées" value={profile.ridesCount} />
            <Row
              label="Note moyenne"
              value={profile.rating > 0 ? `${profile.rating.toFixed(1)} ★` : 'Pas encore de note'}
            />
            <Row
              label="Taux d’acceptation"
              value={profile.acceptanceRate !== null ? `${profile.acceptanceRate} %` : '—'}
            />
            {profile.wallet ? (
              <Row
                label="Solde du portefeuille"
                value={formatAmount(profile.wallet.balance, profile.wallet.currency)}
                emphasis
              />
            ) : null}
          </Card>
        ) : null}

        {profile?.wallet && profile.wallet.balance < 0 ? (
          <Card style={styles.debt}>
            <Text style={styles.debtText}>
              Votre solde est négatif : il correspond aux commissions dues sur les courses
              encaissées en espèces. Régularisez depuis l’onglet Revenus.
            </Text>
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surface0 },
  mapWrapper: { height: '32%', backgroundColor: palette.surface2 },
  sheet: { flex: 1 },
  sheetContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  statusTitle: { ...typography.title, color: palette.textPrimary },
  statusHint: { ...typography.body, color: palette.textSecondary, marginTop: spacing.xs },
  badges: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
  offer: { borderColor: palette.driverAccent, borderWidth: 2 },
  offerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  offerTitle: { ...typography.title, color: palette.textPrimary },
  countdown: { ...typography.title, color: palette.driverAccent },
  countdownTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.surface2,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  countdownFill: { height: 4, backgroundColor: palette.driverAccent },
  waiting: { ...typography.heading, color: palette.textPrimary },
  waitingHint: { ...typography.body, color: palette.textSecondary, marginTop: spacing.xs },
  debt: { backgroundColor: palette.warningBg, borderColor: palette.warning },
  debtText: { ...typography.body, color: palette.warning },
});
