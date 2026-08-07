import { describe, expect, it } from 'vitest';
import {
  boundingBox,
  estimateDurationSeconds,
  haversineMeters,
  isValidCoordinates,
  pathLengthMeters,
} from '../../src/domain/geo.js';

const PLATEAU = { latitude: 5.3364, longitude: -4.0267 }; // Abidjan, Plateau
const COCODY = { latitude: 5.3599, longitude: -3.9906 }; // Abidjan, Cocody

describe('géolocalisation (§4)', () => {
  it('calcule une distance cohérente entre deux points d’Abidjan', () => {
    const distance = haversineMeters(PLATEAU, COCODY);

    // Environ 4,8 km à vol d'oiseau : on vérifie l'ordre de grandeur.
    expect(distance).toBeGreaterThan(4_000);
    expect(distance).toBeLessThan(6_000);
  });

  it('renvoie zéro pour deux points identiques', () => {
    expect(haversineMeters(PLATEAU, PLATEAU)).toBe(0);
  });

  it('est symétrique', () => {
    expect(haversineMeters(PLATEAU, COCODY)).toBe(haversineMeters(COCODY, PLATEAU));
  });

  it('produit un cadre englobant qui contient bien le rayon demandé', () => {
    const box = boundingBox(PLATEAU, 5_000);

    // Un point situé à 4 km plein nord doit tomber dans le cadre.
    const nord = { latitude: PLATEAU.latitude + 0.036, longitude: PLATEAU.longitude };
    expect(haversineMeters(PLATEAU, nord)).toBeLessThan(5_000);
    expect(nord.latitude).toBeLessThanOrEqual(box.maxLat);
    expect(nord.latitude).toBeGreaterThanOrEqual(box.minLat);
  });

  it('élargit le cadre en longitude à mesure qu’on s’éloigne de l’équateur', () => {
    const equateur = boundingBox({ latitude: 0, longitude: 0 }, 5_000);
    const nordique = boundingBox({ latitude: 60, longitude: 0 }, 5_000);

    const largeurEquateur = equateur.maxLon - equateur.minLon;
    const largeurNordique = nordique.maxLon - nordique.minLon;

    expect(largeurNordique).toBeGreaterThan(largeurEquateur);
  });

  it('additionne les segments d’une trace GPS', () => {
    const trace = [
      PLATEAU,
      { latitude: 5.34, longitude: -4.02 },
      { latitude: 5.35, longitude: -4.0 },
      COCODY,
    ];

    const total = pathLengthMeters(trace);
    // La trace suit un chemin : elle est au moins aussi longue que le vol d'oiseau.
    expect(total).toBeGreaterThanOrEqual(haversineMeters(PLATEAU, COCODY));
  });

  it('renvoie zéro pour une trace de moins de deux points', () => {
    expect(pathLengthMeters([])).toBe(0);
    expect(pathLengthMeters([PLATEAU])).toBe(0);
  });

  it('estime une durée à partir d’une distance et d’une vitesse', () => {
    // 10 km à 25 km/h = 24 minutes
    expect(estimateDurationSeconds(10_000, 25)).toBe(1_440);
  });

  it('valide les coordonnées', () => {
    expect(isValidCoordinates(PLATEAU)).toBe(true);
    expect(isValidCoordinates({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isValidCoordinates({ latitude: 0, longitude: 181 })).toBe(false);
    expect(isValidCoordinates({ latitude: Number.NaN, longitude: 0 })).toBe(false);
  });
});
