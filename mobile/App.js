/**
 * InventoryIQ — React Native entry point
 *
 * Wires bottom-tab navigation across five screens. The brain
 * (storage, formulas, ML, sync) lives in src/lib/ — these
 * screens are presentation only.
 */
import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';

import HomeScreen from './src/screens/HomeScreen';
import SalesScreen from './src/screens/SalesScreen';
import ProductsScreen from './src/screens/ProductsScreen';
import ForecastScreen from './src/screens/ForecastScreen';
import MoreScreen from './src/screens/MoreScreen';
import { COLORS } from './src/lib/theme';

const Tab = createBottomTabNavigator();

const tabIcon = (emoji) => ({ focused, color }) => (
  <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.55 }}>{emoji}</Text>
);

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: COLORS.white },
            headerTitleStyle: { fontWeight: '800', color: COLORS.ink },
            tabBarStyle: {
              backgroundColor: COLORS.white,
              borderTopColor: COLORS.border,
              height: 64,
              paddingBottom: 8,
              paddingTop: 6,
            },
            tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
            tabBarActiveTintColor: COLORS.blue,
            tabBarInactiveTintColor: COLORS.muted,
          }}
        >
          <Tab.Screen
            name="Home"
            component={HomeScreen}
            options={{ tabBarIcon: tabIcon('🏠'), title: 'InventoryIQ' }}
          />
          <Tab.Screen
            name="Sales"
            component={SalesScreen}
            options={{ tabBarIcon: tabIcon('📝'), headerShown: false }}
          />
          <Tab.Screen
            name="Products"
            component={ProductsScreen}
            options={{ tabBarIcon: tabIcon('📦'), headerShown: false }}
          />
          <Tab.Screen
            name="Forecast"
            component={ForecastScreen}
            options={{ tabBarIcon: tabIcon('📈'), title: 'Forecast' }}
          />
          <Tab.Screen
            name="More"
            component={MoreScreen}
            options={{ tabBarIcon: tabIcon('⚙️'), title: 'Settings' }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
