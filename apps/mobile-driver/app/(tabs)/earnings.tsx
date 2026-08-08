import {
  WALLET_ENTRY_LABELS,
  WITHDRAWAL_STATUS_LABELS,
  formatAmount,
  formatDateTime,
  palette,
  spacing,
  typography,
  type Earnings,
  type Wallet,
  type WalletTransaction,
  type Withdrawal,
} from '@mobilite/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Empty, ErrorNotice, Field, Loader, Pill, Row } from '../../src/components';
import { useSession } from '../../src/session';

/**
 * Revenus, portefeuille et retraits — §10.
 *
 * Le solde peut être négatif : il correspond alors aux commissions dues sur des
 * courses encaissées en espèces. L'écran l'explique plutôt que d'afficher un
 * nombre rouge sans justification.
 */
export default function EarningsScreen() {
  const { api } = useSession();

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [rules, setRules] = useState<{ minimumAmount: number; maximumAmount: number | null } | null>(null);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);

  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [walletResult, earningsResult, transactionsResult, withdrawalsResult] =
        await Promise.all([
          api.wallet(),
          api.earnings(),
          api.walletTransactions({ limit: 30 }),
          api.withdrawals(),
        ]);

      setWallet(walletResult.wallet);
      setRules(walletResult.rules);
      setEarnings(earningsResult);
      setTransactions(transactionsResult.items);
      setWithdrawals(withdrawalsResult.items);
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

  async function requestWithdrawal() {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await api.requestWithdrawal({
        amount: Number(amount),
        method: 'mobile_money',
        destination: destination.trim(),
      });
      setAmount('');
      setMessage('Demande de retrait enregistrée. Elle sera traitée par la plateforme.');
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  if (!wallet) {
    return (
      <SafeAreaView style={styles.screen} edges={['left', 'right']}>
        <ErrorNotice error={error} onRetry={load} />
        <Loader />
      </SafeAreaView>
    );
  }

  const requested = Number(amount);
  const canWithdraw =
    Number.isFinite(requested) &&
    requested > 0 &&
    requested <= wallet.balance &&
    requested >= (rules?.minimumAmount ?? 0) &&
    destination.trim().length >= 4;

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <ErrorNotice error={error} onRetry={load} />
        {message ? <Text style={styles.success}>{message}</Text> : null}

        <Card>
          <Text style={styles.balanceLabel}>Solde disponible</Text>
          <Text style={[styles.balance, wallet.balance < 0 && styles.balanceNegative]}>
            {formatAmount(wallet.balance, wallet.currency)}
          </Text>
          {wallet.balance < 0 ? (
            <Text style={styles.debtHint}>
              Ce solde correspond aux commissions dues sur vos courses encaissées en espèces.
            </Text>
          ) : null}

          <View style={styles.divider} />

          <Row label="Total gagné" value={formatAmount(wallet.totalEarned, wallet.currency)} />
          <Row
            label="Commissions retenues"
            value={formatAmount(wallet.totalCommission, wallet.currency)}
          />
          <Row label="Total retiré" value={formatAmount(wallet.totalWithdrawn, wallet.currency)} />
        </Card>

        {earnings ? (
          <Card>
            <Text style={styles.sectionTitle}>Ces trente derniers jours</Text>
            <Row label="Courses" value={earnings.rides} />
            <Row label="Montant des courses" value={formatAmount(earnings.grossFares)} />
            <Row label="Commission plateforme" value={formatAmount(earnings.commission)} />
            <Row label="Vos revenus" value={formatAmount(earnings.netEarnings)} emphasis />
          </Card>
        ) : null}

        <Card>
          <Text style={styles.sectionTitle}>Demander un retrait</Text>
          <Field
            label="Montant"
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            placeholder={String(rules?.minimumAmount ?? 1000)}
            hint={`Retrait minimum : ${formatAmount(rules?.minimumAmount ?? 0, wallet.currency)}.`}
          />
          <Field
            label="Numéro mobile money"
            value={destination}
            onChangeText={setDestination}
            keyboardType="phone-pad"
            placeholder="07 00 00 00 01"
          />
          <Button
            label="Demander le retrait"
            onPress={requestWithdrawal}
            disabled={!canWithdraw}
            loading={pending}
          />
          <Text style={styles.note}>
            Le montant est retiré de votre solde dès la demande, puis versé après vérification.
          </Text>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Mes retraits</Text>
          {withdrawals.length === 0 ? <Empty>Aucun retrait demandé.</Empty> : null}
          {withdrawals.map((withdrawal) => (
            <View key={withdrawal.id} style={styles.entry}>
              <View style={{ flex: 1 }}>
                <Text style={styles.entryLabel}>
                  {formatAmount(withdrawal.amount, withdrawal.currency)}
                </Text>
                <Text style={styles.entryDate}>{formatDateTime(withdrawal.created_at)}</Text>
              </View>
              <Pill
                tone={
                  withdrawal.status === 'paid'
                    ? 'good'
                    : ['rejected', 'failed'].includes(withdrawal.status)
                      ? 'critical'
                      : 'warning'
                }
              >
                {WITHDRAWAL_STATUS_LABELS[withdrawal.status] ?? withdrawal.status}
              </Pill>
            </View>
          ))}
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Mouvements du portefeuille</Text>
          {transactions.length === 0 ? <Empty>Aucun mouvement.</Empty> : null}
          {transactions.map((transaction) => (
            <View key={transaction.id} style={styles.entry}>
              <View style={{ flex: 1 }}>
                <Text style={styles.entryLabel}>
                  {WALLET_ENTRY_LABELS[transaction.entry_type] ?? transaction.entry_type}
                </Text>
                <Text style={styles.entryDate}>{formatDateTime(transaction.created_at)}</Text>
              </View>
              <Text
                style={[styles.entryAmount, transaction.amount < 0 && styles.entryAmountNegative]}
              >
                {transaction.amount > 0 ? '+' : ''}
                {formatAmount(transaction.amount, transaction.currency)}
              </Text>
            </View>
          ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surface0 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  balanceLabel: { ...typography.label, color: palette.textSecondary },
  balance: { ...typography.amount, color: palette.textPrimary, marginTop: spacing.xs },
  balanceNegative: { color: palette.critical },
  debtHint: { ...typography.caption, color: palette.warning, marginTop: spacing.sm },
  divider: {
    height: 1,
    backgroundColor: palette.border,
    marginVertical: spacing.md,
  },
  sectionTitle: { ...typography.heading, color: palette.textPrimary, marginBottom: spacing.md },
  note: { ...typography.caption, color: palette.textMuted, marginTop: spacing.sm },
  success: {
    ...typography.body,
    color: palette.good,
    backgroundColor: palette.goodBg,
    padding: spacing.md,
    borderRadius: 8,
    marginBottom: spacing.md,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  entryLabel: { ...typography.body, color: palette.textPrimary },
  entryDate: { ...typography.caption, color: palette.textMuted },
  entryAmount: { ...typography.body, color: palette.good, fontWeight: '600' },
  entryAmountNegative: { color: palette.critical },
});
