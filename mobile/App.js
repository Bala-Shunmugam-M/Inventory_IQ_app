import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View } from 'react-native';

import DashboardScreen from './src/screens/DashboardScreen';
import SKUListScreen from './src/screens/SKUListScreen';
import SalesEntryScreen from './src/screens/SalesEntryScreen';
import ForecastScreen from './src/screens/ForecastScreen';
import MoreScreen from './src/screens/MoreScreen';

const Tab = createBottomTabNavigator();

const navTheme = {
  dark: true,
  colors: {
    primary: '#3B82F6',
    background: '#0B0F1A',
    card: '#121829',
    text: '#E2E8F0',
    border: '#1E293B',
    notification: '#EF4444',
  },
};

const tabIcon = (label) => ({ focused }) => (
  <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.55 }}>{label}</Text>
);

export default function App() {
  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style="light" />
      <Tab.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#121829' },
          headerTintColor: '#E2E8F0',
          tabBarStyle: { backgroundColor: '#121829', borderTopColor: '#1E293B', height: 62, paddingBottom: 8, paddingTop: 6 },
          tabBarActiveTintColor: '#3B82F6',
          tabBarInactiveTintColor: '#64748B',
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        }}
      >
        <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ tabBarIcon: tabIcon('📊') }} />
        <Tab.Screen name="SKUs" component={SKUListScreen} options={{ tabBarIcon: tabIcon('📦'), title: 'SKU Manager' }} />
        <Tab.Screen name="Sales" component={SalesEntryScreen} options={{ tabBarIcon: tabIcon('📝'), title: 'Daily Sales' }} />
        <Tab.Screen name="Forecast" component={ForecastScreen} options={{ tabBarIcon: tabIcon('🤖'), title: 'AI Forecast' }} />
        <Tab.Screen name="More" component={MoreScreen} options={{ tabBarIcon: tabIcon('⋯') }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
