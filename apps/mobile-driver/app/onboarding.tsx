import { DRIVER_STATUS_LABELS, palette, spacing, typography } from '@mobilite/shared';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, ErrorNotice, Field, Loader, Pill, Row } from '../src/components';
import { useSession } from '../src/session';

/**
 * Constitution du dossier chauffeur — §5.
 *
 * « Documents possibles : identité, permis, documents du véhicule, assurance et
 *   immatriculation, sous réserve des exigences réglementaires applicables. »
 *
 * La liste ci-dessous est donc indicative et ajustable : les exigences exactes
 * relèvent du §28 et doivent être confirmées auprès des autorités compétentes.
 * Le serveur n'impose aucune liste figée, il examine les documents transmis.
 *
 * Le dépôt de fichier passe par une URL : l'application ne stocke pas de
 * pièces d'identité, elle transmet la référence d'un fichier déjà déposé sur un
 * espace de stockage. Brancher ici le téléversement retenu (stockage objet
 * signé) avant mise en production.
 */

const DOCUMENT_TYPES = [
  { code: 'identity', label: 'Pièce d’identité' },
  { code: 'license', label: 'Permis de conduire' },
  { code: 'registration', label: 'Carte grise du véhicule' },
  { code: 'insurance', label: 'Attestation d’assurance' },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const { api, profile, refreshProfile, signOut } = useSession();

  const [categories, setCategories] = useState<Array<{ id: string; label: string }>>([]);
  const [vehicles, setVehicles] = useState<Array<{ id: string; make: string; model: string; plate_number: string }>>([]);
  const [documents, setDocuments] = useState<Array<{ id: string; doc_type: string; status: string; review_note: string | null }>>([]);

  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [plate, setPlate] = useState('');
  const [categoryId, setCategoryId] = useState('');

  const [docType, setDocType] = useState(DOCUMENT_TYPES[0]!.code);
  const [docUrl, setDocUrl] = useState('');

  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [vehiclesResult, documentsResult] = await Promise.all([
        api.driverVehicles(),
        api.driverDocuments(),
      ]);
      setVehicles(vehiclesResult.items);
      setDocuments(documentsResult.items);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void load();
      void refreshProfile();
    }, [load, refreshProfile]),
  );

  // Les catégories sont exposées par le parcours client ; elles décrivent le
  // référentiel de la plateforme, pas une donnée propre au client.
  useEffect(() => {
    void api
      .vehicleCategories()
      .then((items) => {
        setCategories(items);
        setCategoryId((current) => current || (items[0]?.id ?? ''));
      })
      .catch(() => undefined);
  }, [api]);

  // Dès que l'administration valide le dossier, l'écran s'efface.
  useEffect(() => {
    if (profile?.status === 'approved') router.replace('/(tabs)');
  }, [profile?.status, router]);

  async function addVehicle() {
    setPending(true);
    setError(null);
    try {
      await api.addVehicle({
        vehicleCategoryId: categoryId,
        make: make.trim(),
        model: model.trim(),
        plateNumber: plate.trim().toUpperCase(),
      });
      setMake('');
      setModel('');
      setPlate('');
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  async function addDocument() {
    setPending(true);
    setError(null);
    try {
      await api.addDocument({ docType, fileUrl: docUrl.trim() });
      setDocUrl('');
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  if (loading || !profile) {
    return (
      <SafeAreaView style={styles.screen} edges={['left', 'right']}>
        <Loader label="Chargement de votre dossier…" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ErrorNotice error={error} onRetry={load} />

        <Card>
          <View style={styles.statusRow}>
            <Text style={styles.statusTitle}>
              {DRIVER_STATUS_LABELS[profile.status] ?? profile.status}
            </Text>
            <Pill tone={profile.status === 'approved' ? 'good' : profile.status === 'pending' ? 'warning' : 'critical'}>
              {profile.status}
            </Pill>
          </View>
          <Text style={styles.statusHint}>
            {profile.status === 'pending'
              ? 'Complétez votre dossier. Un opérateur l’examine avant l’ouverture des courses.'
              : (profile.statusReason ?? 'Contactez l’assistance pour connaître la suite à donner.')}
          </Text>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Mon véhicule</Text>

          {vehicles.length > 0 ? (
            vehicles.map((vehicle) => (
              <Row
                key={vehicle.id}
                label={`${vehicle.make} ${vehicle.model}`}
                value={vehicle.plate_number}
              />
            ))
          ) : (
            <>
              <Field label="Marque" value={make} onChangeText={setMake} placeholder="Toyota" />
              <Field label="Modèle" value={model} onChangeText={setModel} placeholder="Corolla" />
              <Field
                label="Immatriculation"
                value={plate}
                onChangeText={(text) => setPlate(text.toUpperCase())}
                placeholder="AB-1234-CI"
                autoCapitalize="characters"
              />
              <Text style={styles.label}>Catégorie</Text>
              <View style={styles.choices}>
                {categories.map((category) => (
                  <Button
                    key={category.id}
                    label={category.label}
                    variant={categoryId === category.id ? 'primary' : 'secondary'}
                    onPress={() => setCategoryId(category.id)}
                    style={styles.choice}
                  />
                ))}
              </View>
              <Button
                label="Enregistrer mon véhicule"
                onPress={addVehicle}
                loading={pending}
                disabled={!make.trim() || !model.trim() || !plate.trim() || !categoryId}
                style={{ marginTop: spacing.md }}
              />
            </>
          )}
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Mes documents</Text>

          {documents.map((document) => (
            <View key={document.id} style={styles.documentRow}>
              <Row
                label={
                  DOCUMENT_TYPES.find((type) => type.code === document.doc_type)?.label ??
                  document.doc_type
                }
                value={
                  document.status === 'approved'
                    ? 'Validé'
                    : document.status === 'rejected'
                      ? 'Refusé'
                      : 'En examen'
                }
              />
              {document.review_note ? (
                <Text style={styles.reviewNote}>{document.review_note}</Text>
              ) : null}
            </View>
          ))}

          <Text style={[styles.label, { marginTop: spacing.md }]}>Type de document</Text>
          <View style={styles.choices}>
            {DOCUMENT_TYPES.map((type) => (
              <Button
                key={type.code}
                label={type.label}
                variant={docType === type.code ? 'primary' : 'secondary'}
                onPress={() => setDocType(type.code)}
                style={styles.choice}
              />
            ))}
          </View>

          <Field
            label="Lien du document"
            value={docUrl}
            onChangeText={setDocUrl}
            placeholder="https://…"
            autoCapitalize="none"
            keyboardType="url"
            hint="Le téléversement depuis l’appareil reste à brancher sur l’espace de stockage retenu."
          />

          <Button
            label="Transmettre le document"
            onPress={addDocument}
            loading={pending}
            disabled={!docUrl.trim().startsWith('http')}
          />
        </Card>

        <Button
          label="Se déconnecter"
          variant="danger"
          onPress={() => void signOut().then(() => router.replace('/(auth)/phone'))}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surface0 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusTitle: { ...typography.heading, color: palette.textPrimary, flexShrink: 1 },
  statusHint: { ...typography.body, color: palette.textSecondary, marginTop: spacing.sm },
  sectionTitle: { ...typography.heading, color: palette.textPrimary, marginBottom: spacing.md },
  label: { ...typography.label, color: palette.textSecondary, marginBottom: spacing.xs },
  choices: { gap: spacing.sm, marginBottom: spacing.md },
  choice: { paddingVertical: 10 },
  documentRow: { marginBottom: spacing.sm },
  reviewNote: { ...typography.caption, color: palette.critical },
});
