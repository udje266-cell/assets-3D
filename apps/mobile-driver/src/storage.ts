import * as SecureStore from 'expo-secure-store';
import type { TokenStorage } from '@mobilite/shared';

/**
 * Stockage des jetons dans le trousseau sécurisé de l'appareil (§12).
 *
 * Un jeton de session ne va pas dans le stockage applicatif ordinaire : sur un
 * téléphone perdu ou déverrouillé, il vaut l'accès au compte. `SecureStore`
 * s'appuie sur le Keychain (iOS) et le Keystore (Android).
 *
 * En cas d'indisponibilité — rare, mais un trousseau peut refuser l'écriture —
 * l'échec est absorbé : l'utilisateur devra se reconnecter, ce qui est
 * préférable à un plantage au démarrage.
 */
export const secureStorage: TokenStorage = {
  async get(key) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      await SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED,
      });
    } catch {
      // Session non persistée : elle vivra le temps de l'exécution.
    }
  },
  async remove(key) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Rien à faire : la valeur est de toute façon inutilisable.
    }
  },
};
