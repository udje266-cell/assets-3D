// Configuration Metro.
//
// L'application possède son propre `node_modules` : les dépendances natives
// d'Expo sont résolues normalement, y compris celles imbriquées sous
// `node_modules/expo/node_modules`. La recherche hiérarchique reste donc
// active — la désactiver couperait Metro de ces dépendances.
//
// Seul ajout nécessaire : surveiller `packages/shared`, consommé en source
// TypeScript, pour que ses modifications déclenchent un rechargement.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [path.resolve(workspaceRoot, 'packages/shared')];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
