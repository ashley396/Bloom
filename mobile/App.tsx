import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { DashboardScreen } from "./screens/DashboardScreen";
import { OrdersScreen } from "./screens/OrdersScreen";
import { InventoryScreen } from "./screens/InventoryScreen";
import { LibraryScreen } from "./screens/LibraryScreen";
import { MoreScreen } from "./screens/MoreScreen";

const Tab = createBottomTabNavigator();
const Drawer = createDrawerNavigator();

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: true }}>
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: "POS" }} />
      <Tab.Screen name="Orders" component={OrdersScreen} />
      <Tab.Screen name="Inventory" component={InventoryScreen} />
      <Tab.Screen name="Library" component={LibraryScreen} />
      <Tab.Screen name="More" component={MoreScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Drawer.Navigator screenOptions={{ headerShown: false }}>
          <Drawer.Screen name="Main" component={MainTabs} />
        </Drawer.Navigator>
      </NavigationContainer>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
