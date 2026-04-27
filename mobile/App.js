import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, ScrollView } from 'react-native';

import HomeScreen from './src/screens/HomeScreen';
import SalesScreen from './src/screens/SalesScreen';
import ProductsScreen from './src/screens/ProductsScreen';
import ForecastScreen from './src/screens/ForecastScreen';
import MoreScreen from './src/screens/MoreScreen';
import { COLORS } from './src/lib/theme';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('App crashed:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: '#FEF2F2', padding: 24, paddingTop: 60 }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: '#DC2626', marginBottom: 12 }}>
            App Error
          </Text>
          <Text style={{ fontSize: 13, color: '#7B849E', marginBottom: 18 }}>
            Something went wrong. Please screenshot this and share with the developer.
          </Text>
          <ScrollView style={{ flex: 1, backgroundColor: '#fff', padding: 14, borderRadius: 10 }}>
            <Text style={{ fontSize: 12, color: '#0D1226' }}>
              {String(this.state.error?.message || this.state.error)}
              {'\n\n'}
              {String(this.state.error?.stack || '').slice(0, 2000)}
            </Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

const Tab = createBottomTabNavigator();

const tabIcon = (emoji) => ({ focused }) => (
  <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.55 }}>{emoji}</Text>
);

export default function App() {
  return (
    <ErrorBoundary>
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
              options={{ tabBarIcon: tabIcon('Home'), title: 'InventoryIQ' }}
            />
            <Tab.Screen
              name="Sales"
              component={SalesScreen}
              options={{ tabBarIcon: tabIcon('Sales'), headerShown: false }}
            />
            <Tab.Screen
              name="Products"
              component={ProductsScreen}
              options={{ tabBarIcon: tabIcon('Items'), headerShown: false }}
            />
            <Tab.Screen
              name="Forecast"
              component={ForecastScreen}
              options={{ tabBarIcon: tabIcon('AI'), title: 'Forecast' }}
            />
            <Tab.Screen
              name="More"
              component={MoreScreen}
              options={{ tabBarIcon: tabIcon('More'), title: 'Settings' }}
            />
          </Tab.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
