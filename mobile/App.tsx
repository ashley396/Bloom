import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { DashboardScreen } from "./screens/DashboardScreen";
import { OrdersScreen } from "./screens/OrdersScreen";
import { InventoryScreen } from "./screens/InventoryScreen";
import { LibraryScreen } from "./screens/LibraryScreen";
import { MoreScreen } from "./screens/MoreScreen";
import { WebsiteScreen } from "./screens/WebsiteScreen";

const Tab = createBottomTabNavigator();
const Drawer = createDrawerNavigator();
const Stack = createNativeStackNavigator();

function MoreStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="MoreMenu" component={MoreScreen} options={{ title: "More" }} />
      <Stack.Screen name="WebsiteStudio" component={WebsiteScreen} options={{ title: "Website Studio" }} />
    </Stack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: true }}>
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: "POS" }} />
      <Tab.Screen name="Orders" component={OrdersScreen} />
      <Tab.Screen name="Inventory" component={InventoryScreen} />
      <Tab.Screen name="Library" component={LibraryScreen} />
      <Tab.Screen name="More" component={MoreStack} options={{ headerShown: false }} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Drawer.Navigator screenOptions={{ headerShown: false }}>
          <Drawer.Screen name="Main" component={MainTabs} />
          <Drawer.Screen name="Website" component={WebsiteScreen} options={{ title: "Website Studio" }} />
        </Drawer.Navigator>
      </NavigationContainer>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
