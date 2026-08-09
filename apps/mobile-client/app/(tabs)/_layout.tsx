import { palette } from '@mobilite/shared';
import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';

/** Icônes textuelles : pas de dépendance à une bibliothèque d'icônes. */
function TabIcon({ symbol, color }: { symbol: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{symbol}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.surface0 },
        headerShadowVisible: false,
        tabBarActiveTintColor: palette.clientAccent,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarStyle: { backgroundColor: palette.surface1, borderTopColor: palette.border },
        sceneStyle: { backgroundColor: palette.surface0 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Commander',
          headerShown: false,
          tabBarIcon: ({ color }) => <TabIcon symbol="◎" color={color} />,
        }}
      />
      <Tabs.Screen
        name="rides"
        options={{
          title: 'Mes courses',
          tabBarIcon: ({ color }) => <TabIcon symbol="≡" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color }) => <TabIcon symbol="☺" color={color} />,
        }}
      />
    </Tabs>
  );
}
