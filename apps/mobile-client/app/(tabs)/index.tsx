import {
  DEFAULT_REGION,
  formatAmount,
  formatDistance,
  formatDuration,
  isActiveRide,
  palette,
  radius,
  spacing,
  typography,
  type Coordinates,
  type EstimateOption,
  type PaymentMethod,
  type PromotionCheck,
} from '@mobilite/shared';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type MapPressEvent } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, ErrorNotice, Field, Loader, Row } from '../../src/components';
import { useSession } from '../../src/session';

/**
 * Écran de commande — §3.
 *
 * Enchaînement demandé : départ → destination → catégorie de véhicule →
 * estimation → confirmation.
 *
 * Le départ est la position GPS du client, ajustable en déplaçant la carte. La
 * destination se pose d'une pression sur la carte : sans service de recherche
 * d'adresses, c'est le geste le plus direct et il fonctionne hors couverture
 * d'un annuaire de lieux. Le champ d'adresse reste libre, pour que le chauffeur
 * dispose d'un repère lisible.
 */

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'Espèces' },
  { value: 'mobile_money', label: 'Mobile money' },
  { value: 'card', label: 'Carte' },
];

export default function OrderScreen() {
  const router = useRouter();
  const { api } = useSession();
  const mapRef = useRef<MapView | null>(null);

  const [pickup, setPickup] = useState<Coordinates | null>(null);
  const [pickupLabel, setPickupLabel] = useState('Ma position');
  const [dropoff, setDropoff] = useState<Coordinates | null>(null);
  const [dropoffLabel, setDropoffLabel] = useState('');

  const [options, setOptions] = useState<EstimateOption[]>([]);
  const [route, setRoute] = useState<{ distanceMeters: number; durationSeconds: number } | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');

  const [promoCode, setPromoCode] = useState('');
  const [promo, setPromo] = useState<PromotionCheck | null>(null);

  const [locationDenied, setLocationDenied] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Une course déjà en cours reprend la main : le §6 n'autorise qu'une course
  // active par client, l'écran de commande n'a pas de sens tant qu'elle dure.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        try {
          const { items } = await api.clientRides({ limit: 1 });
          const current = items[0];
          if (!cancelled && current && isActiveRide(current.status)) {
            router.replace({ pathname: '/ride/[id]', params: { id: current.id } });
          }
        } catch {
          // Sans réseau, on laisse l'écran de commande : il échouera clairement
          // à la confirmation plutôt que de bloquer sur un écran vide.
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [api, router]),
  );

  useEffect(() => {
    void (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationDenied(true);
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      setPickup(coords);
      mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 600);
    })();
  }, []);

  const estimate = useCallback(async () => {
    if (!pickup || !dropoff) return;

    setEstimating(true);
    setError(null);
    try {
      const result = await api.estimate({ pickup, dropoff });
      setOptions(result.options);
      setRoute({ distanceMeters: result.distanceMeters, durationSeconds: result.durationSeconds });
      setSelectedCategory((current) => current ?? result.options[0]?.vehicleCategoryId ?? null);
    } catch (err) {
      setError(err);
    } finally {
      setEstimating(false);
    }
  }, [api, pickup, dropoff]);

  useEffect(() => {
    if (pickup && dropoff) void estimate();
  }, [pickup, dropoff, estimate]);

  const selected = options.find((option) => option.vehicleCategoryId === selectedCategory);

  async function applyPromo() {
    if (!promoCode || !selected) return;
    setError(null);
    try {
      setPromo(await api.checkPromotion(promoCode.trim().toUpperCase(), selected.total));
    } catch (err) {
      setPromo(null);
      setError(err);
    }
  }

  async function confirm() {
    if (!pickup || !dropoff || !selectedCategory) return;

    setOrdering(true);
    setError(null);
    try {
      const { ride } = await api.requestRide({
        pickup: { ...pickup, address: pickupLabel || null },
        dropoff: { ...dropoff, address: dropoffLabel || null },
        vehicleCategoryId: selectedCategory,
        paymentMethod,
        ...(promo?.eligible && promo.code ? { promotionCode: promo.code } : {}),
      });
      router.replace({ pathname: '/ride/[id]', params: { id: ride.id } });
    } catch (err) {
      setError(err);
    } finally {
      setOrdering(false);
    }
  }

  function handleMapPress(event: MapPressEvent) {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    setDropoff({ latitude, longitude });
    setPromo(null);
  }

  const discounted = selected && promo?.eligible ? selected.total - (promo.discount ?? 0) : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <View style={styles.mapWrapper}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={DEFAULT_REGION}
          showsUserLocation={!locationDenied}
          showsMyLocationButton
          onPress={handleMapPress}
        >
          {pickup ? (
            <Marker coordinate={pickup} title="Départ" description={pickupLabel} pinColor="#2a78d6" />
          ) : null}
          {dropoff ? (
            <Marker
              coordinate={dropoff}
              title="Destination"
              description={dropoffLabel || 'Point choisi'}
              draggable
              onDragEnd={(event) => setDropoff(event.nativeEvent.coordinate)}
            />
          ) : null}
        </MapView>

        {!dropoff ? (
          <View style={styles.mapHint} pointerEvents="none">
            <Text style={styles.mapHintText}>
              Touchez la carte pour placer votre destination.
            </Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        style={styles.sheet}
        contentContainerStyle={styles.sheetContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.handle} />

        <ErrorNotice error={error} onRetry={estimate} />

        {locationDenied ? (
          <Card style={styles.warning}>
            <Text style={styles.warningText}>
              L’accès à votre position est refusé. Placez votre point de départ manuellement en
              déplaçant la carte, ou autorisez la localisation dans les réglages.
            </Text>
          </Card>
        ) : null}

        <Field
          label="Adresse de destination"
          value={dropoffLabel}
          onChangeText={setDropoffLabel}
          placeholder="Ex. : Cocody, Riviera 2"
          hint={dropoff ? undefined : 'Placez d’abord le point sur la carte.'}
        />

        {estimating ? <Loader label="Calcul de l’estimation…" /> : null}

        {options.length > 0 && route ? (
          <>
            <Text style={styles.sectionTitle}>Choisissez votre véhicule</Text>
            <Row label="Trajet" value={`${formatDistance(route.distanceMeters)} · ${formatDuration(route.durationSeconds)}`} />

            {options.map((option) => {
              const active = option.vehicleCategoryId === selectedCategory;
              return (
                <Pressable
                  key={option.vehicleCategoryId}
                  onPress={() => {
                    setSelectedCategory(option.vehicleCategoryId);
                    setPromo(null);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={[styles.option, active && styles.optionActive]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionLabel}>{option.label}</Text>
                    <Text style={styles.optionDetail}>
                      Base {formatAmount(option.detail.baseFare, option.currency)} · distance{' '}
                      {formatAmount(option.detail.distanceAmount, option.currency)} · durée{' '}
                      {formatAmount(option.detail.timeAmount, option.currency)}
                    </Text>
                  </View>
                  <Text style={styles.optionPrice}>
                    {formatAmount(option.total, option.currency)}
                  </Text>
                </Pressable>
              );
            })}

            <Text style={styles.sectionTitle}>Moyen de paiement</Text>
            <View style={styles.methods}>
              {PAYMENT_METHODS.map((method) => (
                <Pressable
                  key={method.value}
                  onPress={() => setPaymentMethod(method.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: paymentMethod === method.value }}
                  style={[styles.method, paymentMethod === method.value && styles.methodActive]}
                >
                  <Text
                    style={[
                      styles.methodLabel,
                      paymentMethod === method.value && styles.methodLabelActive,
                    ]}
                  >
                    {method.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.sectionTitle}>Code promotionnel</Text>
            <View style={styles.promoRow}>
              <View style={{ flex: 1 }}>
                <Field
                  label=""
                  value={promoCode}
                  onChangeText={(text) => setPromoCode(text.toUpperCase())}
                  placeholder="BIENVENUE"
                  autoCapitalize="characters"
                />
              </View>
              <Button
                label="Appliquer"
                variant="secondary"
                onPress={applyPromo}
                disabled={!promoCode || !selected}
                style={styles.promoButton}
              />
            </View>

            {promo ? (
              <Text style={promo.eligible ? styles.promoOk : styles.promoKo}>
                {promo.eligible
                  ? `${promo.label} : −${formatAmount(promo.discount ?? 0, selected?.currency)}`
                  : promo.reason}
              </Text>
            ) : null}

            {selected ? (
              <Card style={styles.total}>
                <Row
                  label="Total à payer"
                  value={formatAmount(discounted ?? selected.total, selected.currency)}
                  emphasis
                />
                {discounted !== null ? (
                  <Text style={styles.totalStrike}>
                    Sans remise : {formatAmount(selected.total, selected.currency)}
                  </Text>
                ) : null}
                <Text style={styles.totalNote}>
                  Le prix final est calculé sur la distance et la durée réelles de la course.
                </Text>
              </Card>
            ) : null}

            <Button
              label="Confirmer la course"
              onPress={confirm}
              loading={ordering}
              disabled={!selectedCategory || !dropoff}
            />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surface0 },
  mapWrapper: { height: '38%', backgroundColor: palette.surface2 },
  mapHint: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: 'rgba(11,11,11,0.75)',
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  mapHintText: { ...typography.label, color: palette.textInverse, textAlign: 'center' },
  sheet: {
    flex: 1,
    backgroundColor: palette.surface0,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    marginTop: -radius.lg,
  },
  sheetContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.borderStrong,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.heading,
    color: palette.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.surface1,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  optionActive: { borderColor: palette.clientAccent, borderWidth: 2 },
  optionLabel: { ...typography.heading, color: palette.textPrimary },
  optionDetail: { ...typography.caption, color: palette.textMuted, marginTop: 2 },
  optionPrice: { ...typography.heading, color: palette.textPrimary },
  methods: { flexDirection: 'row', gap: spacing.sm },
  method: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface1,
    alignItems: 'center',
  },
  methodActive: { borderColor: palette.clientAccent, backgroundColor: '#eaf2fc' },
  methodLabel: { ...typography.label, color: palette.textSecondary },
  methodLabelActive: { color: palette.clientAccent },
  promoRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  promoButton: { marginTop: 0, minWidth: 110 },
  promoOk: { ...typography.label, color: palette.good, marginBottom: spacing.md },
  promoKo: { ...typography.label, color: palette.critical, marginBottom: spacing.md },
  total: { marginTop: spacing.lg },
  totalStrike: { ...typography.caption, color: palette.textMuted, textDecorationLine: 'line-through' },
  totalNote: { ...typography.caption, color: palette.textMuted, marginTop: spacing.sm },
  warning: { backgroundColor: palette.warningBg, borderColor: palette.warning },
  warningText: { ...typography.body, color: palette.warning },
});
