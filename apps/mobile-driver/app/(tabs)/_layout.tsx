import { palette } from '@mobilite/shared';
import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';

function TabIcon({ symbol, color }: { symbol: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{symbol}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.surface0 },
        headerShadowVisible: false,
        tabBarActiveTintColor: palette.driverAccent,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarStyle: { backgroundColor: palette.surface1, borderTopColor: palette.border },
        sceneStyle: { backgroundColor: palette.surface0 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Service',
          headerShown: false,
          tabBarIcon: ({ color }) => <TabIcon symbol="◎" color={color} />,
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Revenus',
          tabBarIcon: ({ color }) => <TabIcon symbol="₣" color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Courses',
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
